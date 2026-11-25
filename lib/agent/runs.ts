import { and, count, desc, eq, inArray, lt, max, sql } from "drizzle-orm";

import { agents, db, runSteps, runs, tasks, type NewRun, type Run, type RunStep } from "@/db";
import { UUID_PATTERN } from "@/lib/agents";

/**
 * The audit log. Every run and every step inside it is written here, so anything an
 * agent did can be traced afterwards — which is also the only way to debug a run that
 * went sideways. See the runs/run_steps tables in db/schema.ts.
 */

type StartRun = Pick<NewRun, "agentId" | "userId" | "trigger"> &
  Partial<Pick<NewRun, "conversationId" | "taskId">>;

export async function startRun(values: StartRun) {
  const [run] = await db
    .insert(runs)
    .values({ ...values, status: "running" })
    .returning({ id: runs.id });
  return run.id;
}

type StepInput = {
  runId: string;
  seq: number;
  type: RunStep["type"];
  tool?: string | null;
  payload: Record<string, unknown>;
};

/** Writes one step and returns its id, which an approval needs to point back at it. */
export async function logStep({ runId, seq, type, tool, payload }: StepInput) {
  const [step] = await db
    .insert(runSteps)
    .values({
      runId,
      seq,
      type,
      tool: tool ?? null,
      payload: redact(payload),
    })
    .returning({ id: runSteps.id });
  return step.id;
}

/**
 * The next step number for a run that is being picked up again after an approval.
 * Without it a resumed turn would restart at 0 and the timeline would read out of order.
 */
export async function nextSeq(runId: string) {
  const [row] = await db.select({ highest: max(runSteps.seq) }).from(runSteps).where(eq(runSteps.runId, runId));
  return (row?.highest ?? -1) + 1;
}

/** Parks a run while an approval is pending. It is finished later, by the resumed turn. */
export async function pauseRunForApproval(runId: string, inputTokens: number, outputTokens: number) {
  await db
    .update(runs)
    .set({ status: "waiting_approval", inputTokens, outputTokens })
    .where(eq(runs.id, runId));
}

/** Puts a paused background run back to `running` once its approval has been decided. */
export async function resumeRunAfterApproval(runId: string) {
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
}

type FinishRun = {
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  error?: string | null;
  inputTokens?: number;
  outputTokens?: number;
};

export async function finishRun({ runId, status, error, inputTokens = 0, outputTokens = 0 }: FinishRun) {
  await db
    .update(runs)
    .set({
      status,
      error: error ?? null,
      inputTokens,
      outputTokens,
      finishedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

/**
 * How long a run may go silent before it counts as dead. The longest single step is a VM
 * tool call at about 2.5 minutes, so an hour without a new step means whatever was running
 * it has gone (a deploy, a crash, a stopped Inngest dev server). A decided approval is
 * picked up within seconds, so a quarter of an hour with no progress after it means the
 * same.
 */
export const STALE_RUN = { silentMs: 60 * 60 * 1000, afterDecisionMs: 15 * 60 * 1000 };

/**
 * Closes runs that can never finish: their worker is gone, so without this they would show
 * as "running" or "waiting for you" for ever, and an approval card could be answered with
 * nobody left to act on it.
 *
 * - `queued` / `running` with no new step for `STALE_RUN.silentMs` → failed.
 * - `waiting_approval` whose approval expired → failed.
 * - `waiting_approval` whose approval was decided more than `afterDecisionMs` ago and the
 *   run never moved on → failed (a resumed run goes back to `running` at once).
 *
 * The pending approval cards of the runs it closes are expired too. Each statement only
 * matches rows already past their limit, so running this often, or twice at once, does no
 * harm. `userId` narrows it to one user (cheap enough to run on a page load).
 */
export async function closeStaleRuns(userId?: number): Promise<number> {
  const mine = userId === undefined ? sql`true` : sql`r.user_id = ${userId}`;
  // As ISO text cast in SQL: postgres-js can't bind a Date inside a raw `sql` template.
  const silent = sql`${new Date(Date.now() - STALE_RUN.silentMs).toISOString()}::timestamptz`;
  const decidedBefore = sql`${new Date(Date.now() - STALE_RUN.afterDecisionMs).toISOString()}::timestamptz`;

  const silentRuns = await db.execute<{ id: string }>(sql`
    update runs r
       set status = 'failed', finished_at = now(),
           error = 'This run stopped responding and was closed. Whatever was running it went away (a restart or a crash); run it again.'
     where ${mine}
       and r.status in ('queued', 'running')
       and coalesce((select max(s.created_at) from run_steps s where s.run_id = r.id), r.started_at) < ${silent}
    returning r.id`);

  const abandoned = await db.execute<{ id: string }>(sql`
    update runs r
       set status = 'failed', finished_at = now(),
           error = case when a.status = 'pending'
             then 'Nobody answered the approval in time, so the run was closed.'
             else 'The approval was answered, but the run had already stopped (a restart or a crash), so it was closed. Run it again.'
           end
      from approvals a
     where a.run_id = r.id
       and ${mine}
       and r.status = 'waiting_approval'
       and (
         (a.status = 'pending' and a.expires_at < now())
         or (a.status <> 'pending' and coalesce(a.decided_at, a.created_at) < ${decidedBefore})
       )
    returning r.id`);

  const closed = [...silentRuns, ...abandoned].map((row) => row.id);
  if (closed.length > 0) {
    // A card for a run that no longer exists would be a button that does nothing.
    await db.execute(sql`
      update approvals set status = 'expired', decided_at = now(), resume = '{}'::jsonb
       where status = 'pending' and run_id in (${sql.join(closed.map((id) => sql`${id}`), sql`, `)})`);
  }
  return closed.length;
}

/**
 * Reading the log back — the Runs tab.
 *
 * Everything here is scoped to a user, because a run holds whatever the agent read: the
 * subject lines of somebody's email, the pages it fetched. There is no unscoped lookup.
 */

export type RunSummary = {
  id: string;
  trigger: Run["trigger"];
  status: Run["status"];
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  startedAt: Date;
  finishedAt: Date | null;
  conversationId: string | null;
  taskId: string | null;
  taskName: string | null;
  /** How many steps the run wrote, for "6 steps" without loading them all. */
  steps: number;
};

/** One agent's runs, newest first, each with the task it belongs to and its step count. */
export async function listRuns(agentId: string, userId: number, limit = 50): Promise<RunSummary[]> {
  if (!UUID_PATTERN.test(agentId)) return [];

  const rows = await db
    .select({
      id: runs.id,
      trigger: runs.trigger,
      status: runs.status,
      error: runs.error,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      conversationId: runs.conversationId,
      taskId: runs.taskId,
      taskName: tasks.name,
    })
    .from(runs)
    .leftJoin(tasks, eq(runs.taskId, tasks.id))
    .where(and(eq(runs.agentId, agentId), eq(runs.userId, userId)))
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // One grouped count instead of a query per run.
  const counts = await db
    .select({ runId: runSteps.runId, total: count() })
    .from(runSteps)
    .where(
      inArray(
        runSteps.runId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(runSteps.runId);

  const byRun = new Map(counts.map((row) => [row.runId, Number(row.total)]));
  return rows.map((row) => ({ ...row, steps: byRun.get(row.id) ?? 0 }));
}

export type RunDetail = {
  run: RunSummary & { agentId: string; agentName: string };
  steps: RunStep[];
};

/** One run with its whole timeline, for the run page. Null if it isn't this user's. */
export async function getRunDetail(runId: string, userId: number): Promise<RunDetail | null> {
  if (!UUID_PATTERN.test(runId)) return null;

  const [row] = await db
    .select({
      id: runs.id,
      trigger: runs.trigger,
      status: runs.status,
      error: runs.error,
      inputTokens: runs.inputTokens,
      outputTokens: runs.outputTokens,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      conversationId: runs.conversationId,
      taskId: runs.taskId,
      taskName: tasks.name,
      agentId: runs.agentId,
      agentName: agents.name,
    })
    .from(runs)
    .innerJoin(agents, eq(runs.agentId, agents.id))
    .leftJoin(tasks, eq(runs.taskId, tasks.id))
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .limit(1);

  if (!row) return null;

  const steps = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(runSteps.seq, runSteps.createdAt);

  return { run: { ...row, steps: steps.length }, steps };
}

/** What a purged step's payload is replaced with, so the UI can say why it is empty. */
const PURGED = { purged: true };

/**
 * Retention: forgets the *contents* of old steps while keeping the shape of the run.
 *
 * A step's payload is the email the agent read and the page it fetched, and there is no
 * reason to hold that for ever (decision D43). The rows stay — what ran, when, and
 * whether it worked is the audit log and costs nothing — but their payloads are emptied.
 */
export async function purgeStepPayloadsBefore(cutoff: Date) {
  const cleared = await db
    .update(runSteps)
    .set({ payload: PURGED })
    .where(
      and(
        lt(runSteps.createdAt, cutoff),
        // Rows already purged are left alone, so the sweep's count means something.
        sql`${runSteps.payload} <> ${JSON.stringify(PURGED)}::jsonb`,
      ),
    )
    .returning({ id: runSteps.id });
  return cleared.length;
}

const SECRET_KEY = /token|secret|password|passwd|credential|api[-_]?key|authorization|cookie/i;
const MAX_LOGGED_STRING = 4_000;

/**
 * Strips anything that looks like a secret before a payload is written, and shortens
 * long strings. Tools get their credentials from the run context, so a token should
 * never appear in a payload — this is the second line of defence, not the first.
 */
function redact(value: unknown, depth = 0): Record<string, unknown> {
  return redactValue(value, depth) as Record<string, unknown>;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[too deep]";
  if (typeof value === "string") {
    const clean = redactUrls(value);
    return clean.length > MAX_LOGGED_STRING ? `${clean.slice(0, MAX_LOGGED_STRING)}…[trimmed]` : clean;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[redacted]" : redactValue(item, depth + 1),
      ]),
    );
  }
  return value;
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>]+/gi;

/**
 * Secrets also travel inside URLs — `?access_token=…`, `?api_key=…`, `user:pass@host` —
 * and a URL the model chose (web.fetch) or a page it read can carry one. Key-based
 * redaction never sees those, so every URL in a logged string is cleaned here.
 */
function redactUrls(text: string) {
  if (!text.includes("://")) return text;
  return text.replace(URL_IN_TEXT, (match) => {
    let url: URL;
    try {
      url = new URL(match);
    } catch {
      return match;
    }
    let changed = false;
    if (url.username || url.password) {
      url.username = "redacted";
      url.password = "";
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key) || /^(sig|signature|code|key|auth|session|sid)$/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? url.toString() : match;
  });
}
