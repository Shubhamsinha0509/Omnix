import { notFound } from "next/navigation";
import { count, eq } from "drizzle-orm";

import AgentSettings from "@/components/custom/workspace/AgentSettings";
import { conversations, db } from "@/db";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";

export default async function AgentSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  // Shown in the delete warning so the user knows what else goes with it.
  const [chats] = await db
    .select({ total: count() })
    .from(conversations)
    .where(eq(conversations.agentId, agent.id));

  return (
    <AgentSettings
      key={agent.id}
      agent={{
        id: agent.id,
        name: agent.name,
        instructions: agent.instructions,
        avatarSeed: agent.avatarSeed,
      }}
      conversationCount={chats?.total ?? 0}
    />
  );
}
