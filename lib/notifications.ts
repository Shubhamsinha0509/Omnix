import { and, count, desc, eq, isNull, lt } from "drizzle-orm";

import { agents, approvals, db, notifications, tasks, type NewNotification } from "@/db";
import { UUID_PATTERN } from "@/lib/agents";

/**
 * In-app delivery: what a user comes back to after their agents have been working.
 *
 * A row here is the whole of "in-app" (decision D42) — the inbox reads it, the sidebar
 * counts the unread ones. Bodies hold an agent's own words, which may quote an email or a
 * web page, so the inbox renders them as Markdown and never as HTML (docs/07-security.md).
 */

/** How long a notification body is kept before it is trimmed, to bound the row size. */
const MAX_BODY = 8_000;

export type NotificationKind = "task_result" | "task_failed" | "approval_request";

export type InboxItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  agentId: string | null;
  agentName: string | null;
  agentAvatarSeed: string | null;
  taskId: string | null;
  taskName: string | null;
  runId: string | null;
  approvalId: string | null;
  /** The approval's state, for an `approval_request`: a decided card shows the outcome. */
  approvalStatus: "pending" | "approved" | "rejected" | "expired" | null;
  approvalTool: string | null;
  approvalSummary: string | null;
  approvalDetails: { label: string; value: string }[];
  approvalExpiresAt: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function notify(input: Omit<NewNotification, "body"> & { body?: string }) {
  const body = (input.body ?? "").slice(0, MAX_BODY);
  const [row] = await db
    .insert(notifications)
    .values({ ...input, body })
    .returning({ id: notifications.id });
  return row.id;
}

/**
 * The inbox, newest first — notifications joined to the things they point at, so a card
 * can be drawn and decided without a second round of queries.
 */
export async function listInbox(userId: number, limit = 50): Promise<InboxItem[]> {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      agentId: notifications.agentId,
      agentName: agents.name,
      agentAvatarSeed: agents.avatarSeed,
      taskId: notifications.taskId,
      taskName: tasks.name,
      runId: notifications.runId,
      approvalId: notifications.approvalId,
      approvalStatus: approvals.status,
      approvalTool: approvals.tool,
      approvalSummary: approvals.summary,
      approvalDetails: approvals.details,
      approvalExpiresAt: approvals.expiresAt,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(agents, eq(notifications.agentId, agents.id))
    .leftJoin(tasks, eq(notifications.taskId, tasks.id))
    .leftJoin(approvals, eq(notifications.approvalId, approvals.id))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    approvalDetails: Array.isArray(row.approvalDetails)
      ? (row.approvalDetails as { label: string; value: string }[])
      : [],
    approvalExpiresAt: row.approvalExpiresAt?.toISOString() ?? null,
  }));
}

export async function countUnread(userId: number) {
  const [row] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.total ?? 0;
}

export async function markRead(userId: number, notificationId: string) {
  if (!UUID_PATTERN.test(notificationId)) return false;
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return Boolean(row);
}

export async function markAllRead(userId: number) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** Drops notifications older than the retention window (decision D43). */
export async function purgeNotificationsBefore(cutoff: Date) {
  const deleted = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });
  return deleted.length;
}

/** Shortens an agent's reply for a notification title without cutting a word in half. */
export function titleFrom(text: string, max = 120) {
  const line = text.trim().split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  const clean = line.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > 40 ? cut.slice(0, space) : cut}…`;
}
