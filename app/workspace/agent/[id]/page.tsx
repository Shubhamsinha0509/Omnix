import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";

import AgentChat from "@/components/custom/workspace/AgentChat";
import { conversations, db, messages } from "@/db";
import { listPendingForConversation } from "@/lib/agent/approvals";
import { hasModelKey } from "@/lib/ai";
import { TOOLS } from "@/lib/tools";
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

  // The reply and any card still waiting in it. An approval outlives the stream that
  // drew it, so reopening a chat has to show it again (decision D35).
  const [history, pending] = activeId
    ? await Promise.all([
        db
          .select({ id: messages.id, role: messages.role, content: messages.content })
          .from(messages)
          .where(eq(messages.conversationId, activeId))
          .orderBy(asc(messages.createdAt)),
        listPendingForConversation(user.id, activeId),
      ])
    : [[], []];

  return (
    <AgentChat
      // Remount only when switching agents. Switching chats is handled inside AgentChat,
      // so the refresh that follows a brand-new chat getting its id doesn't wipe it.
      key={agent.id}
      agent={{
        id: agent.id,
        name: agent.name,
        avatarSeed: agent.avatarSeed,
        instructions: agent.instructions,
      }}
      conversations={chats}
      initialConversationId={activeId}
      initialMessages={history}
      initialApprovals={pending.map((approval) => ({
        id: approval.id,
        tool: approval.tool,
        label: TOOLS[approval.tool]?.label ?? "Waiting for approval",
        summary: approval.summary,
        details: approval.details,
        expiresAt: approval.expiresAt.toISOString(),
        resumable: approval.resumable,
      }))}
      aiReady={hasModelKey()}
    />
  );
}
