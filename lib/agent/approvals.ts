import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { approvals, db, runs, type Approval } from "@/db";
import type { ApprovalSummary } from "@/lib/tools";

/**
 * Approvals: the pause between an agent deciding to do something and it happening.
 *
 * The run's own state is stored with the approval because a chat turn is a single HTTP
 * request and cannot sit waiting for a click (decision D35). When the user decides, a new
 * request executes the **stored** payload and carries on from the stored messages — so
 * what happens is what the card showed, even if the mailbox the agent read has changed
 * its mind since.
 *
 * Background runs in Phase 4 wait on an Inngest event instead and keep their state in the
 * step; everything else here — the row, the risk rules, the card — is shared.
 */

/** 24 hours, the same window `step.waitForEvent` will use for background runs. */
const TTL_MS = 24 * 60 * 60_000;

/**
 * How much resume state is worth keeping. A turn that has read a dozen long emails can
 * be large, and a pending approval is not worth a megabyte of jsonb per click; past this
 * the action can still be approved, it just finishes with a note instead of the agent
 * carrying on. See `resumable` below.
 */
const MAX_RESUME_BYTES = 256_000;

/** The paused turn, as the resumed request needs to pick it up. */
export type ApprovalResume = {
  /** The model conversation so far, including the assistant turn that asked for the tool. */
  messages: ChatCompletionMessageParam[];
  /** The timezone the paused turn ran in, so dates don't change under the user. */
  timezone: string;
  /** Model turns already used, so the resumed run keeps the same iteration budget. */
  iteration: number;
  /** Tool calls and tokens already spent, so limits and usage stay honest across the pause. */
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
};

export type PendingApproval = {
  id: string;
  runId: string;
  conversationId: string | null;
  tool: string;
  toolCallId: string;
  summary: string;
  details: { label: string; value: string }[];
  createdAt: Date;
  expiresAt: Date;
  /** False when the paused turn was too big to keep: the action runs, the agent stops there. */
  resumable: boolean;
};

type CreateApproval = {
  runId: string;
  userId: number;
  conversationId: string | null;
  stepId: string | null;
  tool: string;
  toolCallId: string;
  card: ApprovalSummary;
  /** The exact validated arguments. This is what runs on approval, never a fresh call. */
  payload: Record<string, unknown>;
  resume: ApprovalResume;
};

export async function createApproval(input: CreateApproval): Promise<PendingApproval> {
  const resume = JSON.stringify(input.resume);
  const resumable = resume.length <= MAX_RESUME_BYTES;

  const [row] = await db
    .insert(approvals)
    .values({
      runId: input.runId,
      userId: input.userId,
      conversationId: input.conversationId,
      stepId: input.stepId,
      tool: input.tool,
      toolCallId: input.toolCallId,
      summary: input.card.summary,
      details: input.card.details ?? [],
      payload: input.payload,
      resume: resumable ? input.resume : {},
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .returning();

  return toPending(row);
}

/**
 * The approvals still waiting in a conversation, so reopening the chat shows the card
 * again instead of losing it with the stream that drew it.
 */
export async function listPendingForConversation(
  userId: number,
  conversationId: string,
): Promise<PendingApproval[]> {
  await expireOverdue(userId);

  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.userId, userId),
        eq(approvals.conversationId, conversationId),
        eq(approvals.status, "pending"),
      ),
    )
    .orderBy(asc(approvals.createdAt));

  return rows.map(toPending);
}

/** What was decided, for a card that has already been acted on. */
export async function getApproval(userId: number, approvalId: string) {
  if (!UUID.test(approvalId)) return null;
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * The approval plus the agent whose run it belongs to.
 *
 * A decision has to be made *as* that agent — its tools and its connections decide what
 * the approved action can still do — and the run only records the agent id, so the two
 * are read together rather than by two callers who might disagree.
 */
export async function findApprovalRun(userId: number, approvalId: string) {
  if (!UUID.test(approvalId)) return null;

  const [row] = await db
    .select({
      id: approvals.id,
      runId: approvals.runId,
      agentId: runs.agentId,
      conversationId: approvals.conversationId,
      tool: approvals.tool,
      summary: approvals.summary,
      status: approvals.status,
      expiresAt: approvals.expiresAt,
    })
    .from(approvals)
    .innerJoin(runs, eq(approvals.runId, runs.id))
    .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
    .limit(1);

  return row ?? null;
}

export type ClaimedApproval = {
  row: Approval;
  payload: Record<string, unknown>;
  resume: ApprovalResume | null;
};

/**
 * Claims an approval for a decision, in one conditional `UPDATE`.
 *
 * Two clicks — a double-tap, or two open tabs — must not both execute. Only the request
 * whose update changes the row gets the payload back; the other finds nothing pending and
 * is told what the decision already was. The same guard keeps an expired card from acting.
 */
export async function claimApproval(
  userId: number,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<ClaimedApproval | null> {
  if (!UUID.test(approvalId)) return null;

  const [row] = await db
    .update(approvals)
    .set({ status: decision, decidedAt: new Date() })
    .where(
      and(
        eq(approvals.id, approvalId),
        eq(approvals.userId, userId),
        eq(approvals.status, "pending"),
        gt(approvals.expiresAt, sql`now()`),
      ),
    )
    .returning();

  if (!row) return null;

  return {
    row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    resume: readResume(row.resume),
  };
}

/**
 * Reads the stored turn back, or null if there isn't a usable one.
 *
 * It comes out of jsonb as `unknown`, and a row written before a change to the shape —
 * or cleared after an earlier decision — must read as "can't resume" rather than crash
 * the request the user is waiting on.
 */
function readResume(value: unknown): ApprovalResume | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ApprovalResume>;
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) return null;
  if (typeof candidate.timezone !== "string") return null;

  return {
    messages: candidate.messages,
    timezone: candidate.timezone,
    iteration: Number(candidate.iteration) || 0,
    toolCalls: Number(candidate.toolCalls) || 0,
    inputTokens: Number(candidate.inputTokens) || 0,
    outputTokens: Number(candidate.outputTokens) || 0,
  };
}

/**
 * Drops the copy of the paused turn once it has been used.
 *
 * It holds whatever the agent had read — quite possibly several emails — and there is no
 * reason to keep that sitting in a second table after the decision (docs/07-security.md).
 */
export async function clearResume(approvalId: string) {
  await db.update(approvals).set({ resume: {} }).where(eq(approvals.id, approvalId));
}

/**
 * Marks overdue cards expired, so a card from yesterday reads as expired rather than
 * waiting. Done on read instead of on a schedule: there is nothing to act on until
 * somebody looks, and Phase 4's `waitForEvent` handles its own timeout.
 */
export async function expireOverdue(userId: number) {
  await db
    .update(approvals)
    .set({ status: "expired", decidedAt: new Date(), resume: {} })
    .where(
      and(
        eq(approvals.userId, userId),
        eq(approvals.status, "pending"),
        lt(approvals.expiresAt, sql`now()`),
      ),
    );
}

function toPending(row: Approval): PendingApproval {
  return {
    id: row.id,
    runId: row.runId,
    conversationId: row.conversationId,
    tool: row.tool,
    toolCallId: row.toolCallId,
    summary: row.summary,
    details: Array.isArray(row.details) ? (row.details as { label: string; value: string }[]) : [],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resumable: Boolean((row.resume as { messages?: unknown })?.messages),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
