import type { Agent } from "@/db";
import type { AgentFacts } from "@/lib/agent-guide";
import type { SafeConnection } from "@/lib/integrations/connections";
import { hasSandboxKey } from "@/lib/sandbox";
import type { Task } from "@/db";
import type { ToolSetting } from "@/lib/tools";

/**
 * The facts `lib/agent-guide.ts` reasons over, from what a page has already loaded: the
 * agent, its tool settings, the user's connections and the agent's tasks. Server only
 * (it asks whether E2B is configured).
 */
export function agentFacts(
  agent: Pick<Agent, "name" | "instructions">,
  data: {
    tools: ToolSetting[];
    connections: Pick<SafeConnection, "provider" | "status">[];
    tasks: Pick<Task, "enabled" | "trigger">[];
  },
): AgentFacts {
  return {
    name: agent.name,
    instructions: agent.instructions,
    enabledTools: data.tools.filter((tool) => tool.enabled).map((tool) => tool.key),
    availableTools: data.tools.filter((tool) => !tool.needsConnection).map((tool) => tool.key),
    connectedProviders: data.connections.filter((c) => c.status === "active").map((c) => c.provider),
    hasSchedule: data.tasks.some((task) => task.enabled && task.trigger === "schedule"),
    vmAvailable: hasSandboxKey(),
  };
}
