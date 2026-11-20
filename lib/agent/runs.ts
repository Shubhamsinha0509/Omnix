import { eq, max } from "drizzle-orm";

import { db, runSteps, runs, type NewRun, type RunStep } from "@/db";

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
