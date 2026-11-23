import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";

import AgentChat from "@/components/custom/workspace/AgentChat";
import { conversations, db, messages } from "@/db";
import { listPendingForConversation } from "@/lib/agent/approvals";
import { CHAT_MODEL, hasModelKey } from "@/lib/ai";
import { modelLabel } from "@/lib/format";
import type { ConfigTab } from "@/components/custom/workspace/AgentConfigPanel";
import { TOOLS, listToolSettings } from "@/lib/tools";
import { listConnections } from "@/lib/integrations/connections";
import { UUID_PATTERN, getOwnedAgent, listConversations } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { getSandbox, hasSandboxKey } from "@/lib/sandbox";
import { listTasks, toTaskView } from "@/lib/tasks";

type Props = {
  params: Promise<{ id: string }>;
  /**
   * `?c=<conversation id>` opens a past chat; without it, the most recent one.
   * `?new=1&prompt=…` (from Home) starts a new chat and sends the prompt.
   * `?configure=<tab>` opens the configuration drawer on that tab.
   */
  searchParams: Promise<{ c?: string; new?: string; prompt?: string; configure?: string }>;
};

export default async function AgentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { c: requested, new: fresh, prompt, configure } = await searchParams;
  const TABS: ConfigTab[] = ["instructions", "tools", "schedule", "settings"];
  const initialTab = TABS.find((tab) => tab === configure) ?? null;
  const initialPrompt = prompt?.trim().slice(0, 8000) || null;

  const user = await getCurrentUser();
  if (!user) notFound();

  // Only the owner can open an agent.
  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  // The chat list, plus what the configuration panel beside the chat needs.
  const [chats, tools, connections, tasks, vm] = await Promise.all([
    listConversations(agent.id, user.id),
    listToolSettings(agent),
    listConnections(user.id),
    listTasks(agent.id, user.id),
    // The agent's VM for the run panel, checked with E2B if it may have paused itself.
    getSandbox(user.id, agent.id),
  ]);

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
  } else if (!fresh && !initialPrompt) {
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
      config={{
        tools,
        connections,
        conversationCount: chats.length,
        tasks: tasks.map(toTaskView),
        model: { id: CHAT_MODEL, label: modelLabel(CHAT_MODEL) },
      }}
      initialPrompt={initialPrompt}
      initialTab={initialTab}
      vm={{ ready: hasSandboxKey(), initial: vm }}
    />
  );
}
