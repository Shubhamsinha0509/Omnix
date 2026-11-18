"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { agents, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
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

export async function createAgent(input: AgentInput): Promise<ActionResult> {
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
  } catch (error) {
    console.error("Failed to create agent:", error);
    return { error: "Couldn't save your agent. Please try again." };
  }

  // Refresh the sidebar (it lives in the workspace layout), then open the new agent.
  revalidatePath("/workspace", "layout");
  redirect(`/workspace/agent/${agentId}`);
}

/** Saves changes to an agent the signed-in user owns, then reopens its chat. */
export async function updateAgent(agentId: string, input: AgentInput): Promise<ActionResult> {
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
