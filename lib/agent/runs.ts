import { eq } from "drizzle-orm";

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

export async function logStep({ runId, seq, type, tool, payload }: StepInput) {
  await db.insert(runSteps).values({
    runId,
    seq,
    type,
    tool: tool ?? null,
    payload: redact(payload),
  });
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
    return value.length > MAX_LOGGED_STRING ? `${value.slice(0, MAX_LOGGED_STRING)}…[trimmed]` : value;
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
