import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";

import AgentChat from "@/components/custom/workspace/AgentChat";
import { conversations, db, messages } from "@/db";
import { hasModelKey } from "@/lib/ai";
import { UUID_PATTERN, getOwnedAgent, listConversations } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";

type Props = {
  params: Promise<{ id: string }>;
  /** `?c=<conversation id>` opens a past chat; without it, the most recent one. */
  searchParams: Promise<{ c?: string }>;
};

export default async function AgentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { c: requested } = await searchParams;

  const user = await getCurrentUser();
  if (!user) notFound();

  // Only the owner can open an agent.
  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  const chats = await listConversations(agent.id, user.id);

  // The chat to show: the one asked for, or the most recent one.
  let activeId: string | null = null;
  if (requested) {
    if (!UUID_PATTERN.test(requested)) notFound();
    const [found] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, requested),
          eq(conversations.agentId, agent.id),
          eq(conversations.userId, user.id),
        ),
      )
      .limit(1);
    if (!found) notFound();
    activeId = found.id;
  } else {
    activeId = chats[0]?.id ?? null;
  }

  const history = activeId
    ? await db
        .select({ id: messages.id, role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, activeId))
        .orderBy(asc(messages.createdAt))
    : [];

  return (
    <AgentChat
      // Remount when switching agents or chats so state from the previous one doesn't leak.
      key={`${agent.id}:${activeId ?? "new"}`}
      agent={{
        id: agent.id,
        name: agent.name,
        avatarSeed: agent.avatarSeed,
        instructions: agent.instructions,
      }}
      conversations={chats}
      initialConversationId={activeId}
      initialMessages={history}
      aiReady={hasModelKey()}
    />
  );
}
