import { notFound } from "next/navigation";

import AgentNav from "@/components/custom/workspace/AgentNav";
import AgentTasks from "@/components/custom/workspace/AgentTasks";
import { vmStateOf } from "@/lib/vm-state";
import { listToolSettings } from "@/lib/tools";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { listTasks, toTaskView } from "@/lib/tasks";

/** The Tasks tab: everything this agent does on its own. */
export default async function AgentTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) notFound();

  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  // The tool settings too: the task form warns when a scheduled run would stop for approval.
  const [tasks, tools] = await Promise.all([listTasks(agent.id, user.id), listToolSettings(agent)]);

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col md:h-svh">
      <AgentNav agent={agent} active="tasks" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <AgentTasks
            agentId={agent.id}
            agentName={agent.name}
            tasks={tasks.map(toTaskView)}
            vm={vmStateOf(tools)}
          />
        </div>
      </div>
    </div>
  );
}
