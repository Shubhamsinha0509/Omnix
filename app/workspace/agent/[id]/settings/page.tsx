import { notFound } from "next/navigation";
import { count, eq } from "drizzle-orm";

import AgentNav from "@/components/custom/workspace/AgentNav";
import AgentSettings from "@/components/custom/workspace/AgentSettings";
import { conversations, db } from "@/db";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { listConnections } from "@/lib/integrations/connections";
import { listToolSettings } from "@/lib/tools";

export default async function AgentSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  const [[chats], tools, connections] = await Promise.all([
    // Shown in the delete warning so the user knows what else goes with it.
    db.select({ total: count() }).from(conversations).where(eq(conversations.agentId, agent.id)),
    listToolSettings(agent),
    listConnections(user.id),
  ]);

  return (
    <div className="flex h-svh flex-col">
      <AgentNav agent={agent} active="settings" />
      <div className="flex-1 overflow-y-auto">
        <AgentSettings
          key={agent.id}
          agent={{
            id: agent.id,
            name: agent.name,
            instructions: agent.instructions,
            avatarSeed: agent.avatarSeed,
          }}
          conversationCount={chats?.total ?? 0}
          tools={tools}
          connections={connections}
        />
      </div>
    </div>
  );
}
