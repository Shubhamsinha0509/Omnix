"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { agentTools, agents, db } from "@/db";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { getConnection } from "@/lib/integrations/connections";
import { TOOLS, isNativeTool } from "@/lib/tools";
import { AVATAR_SEED_PATTERN } from "@/components/custom/workspace/AgentAvatar";
import { MAX_AGENT_INSTRUCTIONS, MAX_AGENT_NAME } from "@/lib/agent-limits";

export type AgentInput = {
  name: string;
  instructions: string;
  avatarSeed: string;
};

/** Server actions return an error to show in the form, or nothing on success. */
export type ActionResult = { error: string } | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Never trust the browser: check everything again on the server. */
function validate(input: AgentInput): { error: string } | { values: AgentInput } {
  const name = input.name?.trim() ?? "";
  const instructions = input.instructions?.trim() ?? "";
  const avatarSeed = input.avatarSeed ?? "";

  if (!name) return { error: "Please give your agent a name." };
  if (name.length > MAX_AGENT_NAME) {
    return { error: `Name must be ${MAX_AGENT_NAME} characters or fewer.` };
  }
  if (instructions.length > MAX_AGENT_INSTRUCTIONS) {
    return { error: `Instructions must be ${MAX_AGENT_INSTRUCTIONS} characters or fewer.` };
  }
  if (!AVATAR_SEED_PATTERN.test(avatarSeed)) {
    return { error: "Invalid avatar. Please shuffle and try again." };
  }

  return { values: { name, instructions, avatarSeed } };
}

/**
 * What Create agent lets you switch off up front (11-create-agent). Both map to built-in
 * tools that are on by default, so "off" is stored as a disabled grant.
 */
export type CreateCapabilities = { webSearch: boolean; toolUse: boolean };

const CAPABILITY_TOOLS: Record<keyof CreateCapabilities, string[]> = {
  webSearch: ["web.search", "web.fetch"],
  toolUse: ["time.now"],
};

export async function createAgent(
  input: AgentInput,
  capabilities: CreateCapabilities = { webSearch: true, toolUse: true },
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in to create an agent." };

  const checked = validate(input);
  if ("error" in checked) return checked;

  let agentId: string;
  try {
    const [agent] = await db
      .insert(agents)
      .values({ userId: user.id, ...checked.values })
      .returning({ id: agents.id });
    agentId = agent.id;

    const off = (Object.keys(CAPABILITY_TOOLS) as (keyof CreateCapabilities)[])
      .filter((key) => capabilities[key] === false)
      .flatMap((key) => CAPABILITY_TOOLS[key])
      .filter((tool) => TOOLS[tool]);
    if (off.length > 0) {
      await db
        .insert(agentTools)
        .values(off.map((tool) => ({ agentId, tool, enabled: false, connectionId: null, approval: "never" as const })))
        .onConflictDoNothing();
    }
  } catch (error) {
    console.error("Failed to create agent:", error);
    return { error: "Couldn't save your agent. Please try again." };
  }

  // Refresh the sidebar (it lives in the workspace layout), then show the success screen.
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/agent/${agentId}/created`);
}

/**
 * Saves changes to an agent the signed-in user owns, then reopens its chat — or, with
 * `stay`, just refreshes, for the configuration panel that sits beside the chat.
 */
export async function updateAgent(
  agentId: string,
  input: AgentInput,
  options: { stay?: boolean } = {},
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in to edit an agent." };
  if (!UUID.test(agentId)) return { error: "Agent not found." };

  const checked = validate(input);
  if ("error" in checked) return checked;

  try {
    const updated = await db
      .update(agents)
      .set(checked.values)
      .where(and(eq(agents.id, agentId), eq(agents.userId, user.id)))
      .returning({ id: agents.id });
    if (updated.length === 0) return { error: "Agent not found." };
  } catch (error) {
    console.error("Failed to update agent:", error);
    return { error: "Couldn't save your changes. Please try again." };
  }

  revalidatePath("/workspace", "layout");
  if (options.stay) return undefined;
  redirect(`/workspace/agent/${agentId}`);
}

/** Deletes an agent and, through the database, all of its conversations. */
export async function deleteAgent(agentId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in to delete an agent." };
  if (!UUID.test(agentId)) return { error: "Agent not found." };

  try {
    const deleted = await db
      .delete(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, user.id)))
      .returning({ id: agents.id });
    if (deleted.length === 0) return { error: "Agent not found." };
  } catch (error) {
    console.error("Failed to delete agent:", error);
    return { error: "Couldn't delete this agent. Please try again." };
  }

  revalidatePath("/workspace", "layout");
  redirect("/workspace");
}

/** One change to an agent's tool settings. Sent as the user flips each control. */
export type ToolGrantInput = {
  tool: string;
  enabled: boolean;
  /** The account to use, or null for "whichever account I've connected". */
  connectionId: string | null;
  approval: "never" | "always";
};

/**
 * Saves one tool grant for an agent.
 *
 * The three rules that matter are all enforced here rather than trusted from the form:
 * the tool has to exist, the account has to be this user's and of the right provider, and
 * the approval setting is clamped to what the tool's risk allows — `read` never asks and
 * `destructive` always does, whatever arrives (decision D29).
 */
export async function updateAgentTool(agentId: string, input: ToolGrantInput): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };
  if (!UUID.test(agentId)) return { error: "Agent not found." };

  const agent = await getOwnedAgent(user.id, agentId);
  if (!agent) return { error: "Agent not found." };

  const tool = TOOLS[input.tool];
  if (!tool) return { error: "That tool doesn't exist." };

  const provider = isNativeTool(tool) ? undefined : tool.provider;
  let connectionId: string | null = null;

  if (input.connectionId) {
    if (!provider) return { error: "That tool doesn't use a connected account." };
    const connection = await getConnection(user.id, input.connectionId);
    if (!connection) return { error: "That account isn't connected." };
    if (connection.provider !== provider) {
      return { error: `That account can't be used for ${tool.label.toLowerCase()}.` };
    }
    connectionId = connection.id;
  }

  // The stored value is the user's preference; the runner applies the risk floor again.
  const approval =
    tool.risk === "read" ? "never" : tool.risk === "destructive" ? "always" : input.approval;

  try {
    await db
      .insert(agentTools)
      .values({ agentId: agent.id, tool: input.tool, enabled: input.enabled, connectionId, approval })
      .onConflictDoUpdate({
        target: [agentTools.agentId, agentTools.tool],
        set: { enabled: input.enabled, connectionId, approval, updatedAt: new Date() },
      });
  } catch (error) {
    console.error("Failed to save the agent's tool settings:", error);
    return { error: "Couldn't save that. Please try again." };
  }

  revalidatePath(`/workspace/agent/${agent.id}/settings`);
  return undefined;
}
