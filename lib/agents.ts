import { and, desc, eq } from "drizzle-orm";

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
