"use server";

import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import {
  getSandbox,
  getSandboxStats,
  openSandboxScreen,
  pauseSandbox,
  startSandbox,
  stopSandbox,
  type SandboxResult,
  type SandboxScreen,
  type SandboxStats,
  type SandboxView,
} from "@/lib/sandbox";

/**
 * Server actions for an agent's VM (docs/06-virtual-machines.md), called by the run panel.
 * The agent has to belong to the person asking (D14); everything else is in lib/sandbox.
 */

async function owner(agentId: string): Promise<{ error: string } | { userId: number }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in to use a VM." };
  const agent = await getOwnedAgent(user.id, agentId);
  if (!agent) return { error: "Agent not found." };
  return { userId: user.id };
}

/** The VM's current state, checked with E2B if it may have paused itself. */
export async function getVm(agentId: string): Promise<SandboxResult> {
  const who = await owner(agentId);
  if ("error" in who) return who;
  return { vm: await getSandbox(who.userId, agentId) };
}

/** Starts the VM, or resumes it if paused. */
export async function startVm(agentId: string): Promise<SandboxResult> {
  const who = await owner(agentId);
  if ("error" in who) return who;
  return startSandbox(who.userId, agentId);
}

/** Pauses the VM, keeping its files and memory. */
export async function pauseVm(agentId: string): Promise<SandboxResult> {
  const who = await owner(agentId);
  if ("error" in who) return who;
  return pauseSandbox(who.userId, agentId);
}

/** Links to the running VM's live screen, for this browser only. */
export async function openVmScreen(
  agentId: string,
): Promise<{ error: string } | { screen: SandboxScreen; vm: SandboxView }> {
  const who = await owner(agentId);
  if ("error" in who) return who;
  return openSandboxScreen(who.userId, agentId);
}

/** The running VM's CPU, memory and disk. */
export async function getVmStats(agentId: string): Promise<{ error: string } | { stats: SandboxStats }> {
  const who = await owner(agentId);
  if ("error" in who) return who;
  return getSandboxStats(who.userId, agentId);
}

/** Stops the VM and deletes everything on it. */
export async function stopVm(agentId: string): Promise<SandboxResult> {
  const who = await owner(agentId);
  if ("error" in who) return who;
  return stopSandbox(who.userId, agentId);
}
