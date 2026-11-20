import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { agents, conversations, db } from "@/db";

/** Agent and conversation ids are UUIDs; anything else is a 404, not a database error. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The agent with this id, but only if the given user owns it — otherwise null.
 * Every route that touches an agent goes through here.
 */
export async function getOwnedAgent(userId: number, agentId: string) {
  if (!UUID_PATTERN.test(agentId)) return null;

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);

  return agent ?? null;
}

/** An agent's conversations, most recently used first. */
export async function listConversations(agentId: string, userId: number, limit = 50) {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(eq(conversations.agentId, agentId), eq(conversations.userId, userId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

export type ConversationSummary = Awaited<ReturnType<typeof listConversations>>[number];

/**
 * How long a conversation stays claimed if a turn never releases it (a crashed server).
 * Longer than any real turn; a normal turn always releases it in `finally`.
 */
export const CONVERSATION_LEASE = sql`now() + interval '10 minutes'`;

/**
 * Claims a conversation for one turn, so two overlapping replies can't both generate
 * from history missing the other's turn (decision D30).
 *
 * One conditional `UPDATE`: free, or the lease has expired. Two requests cannot both win,
 * because only one of them changes the row. Used by the chat route and by resuming an
 * approval, which is also a turn in that conversation.
 */
export async function claimConversation(
  conversationId: string,
  userId: number,
  /** Also require the conversation to belong to this agent, where the caller knows it. */
  agentId?: string,
): Promise<"claimed" | "busy" | "missing"> {
  if (!UUID_PATTERN.test(conversationId)) return "missing";

  const owned = and(
    eq(conversations.id, conversationId),
    eq(conversations.userId, userId),
    ...(agentId ? [eq(conversations.agentId, agentId)] : []),
  );
  const [claimed] = await db
    .update(conversations)
    .set({ busyUntil: CONVERSATION_LEASE })
    .where(and(owned, or(isNull(conversations.busyUntil), lt(conversations.busyUntil, sql`now()`))))
    .returning({ id: conversations.id });

  if (claimed) return "claimed";

  const [exists] = await db.select({ id: conversations.id }).from(conversations).where(owned).limit(1);
  return exists ? "busy" : "missing";
}

/** Releases a conversation's lease and marks it as just updated. */
export async function releaseConversation(conversationId: string) {
  await db
    .update(conversations)
    .set({ busyUntil: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
