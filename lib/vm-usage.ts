import { and, eq, gte, sql } from "drizzle-orm";

import { db, sandboxes, vmUsage } from "@/db";
import { MOCK_CURRENT_PLAN_ID } from "@/lib/mock-data";
import { getPlan } from "@/lib/pricing";

/**
 * VM time per month, against the plan's allowance (lib/pricing.ts). A month is a calendar
 * month in UTC; a stretch counts in the month it ended, and a VM running right now counts
 * up to this moment.
 *
 * Which plan a user is on is still mock (`MOCK_CURRENT_PLAN_ID`) until billing exists.
 */

/** The user's plan allowance in seconds. */
export function vmAllowanceSeconds(_userId: number) {
  return getPlan(MOCK_CURRENT_PLAN_ID).allowances.vmMinutesPerMonth * 60;
}

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** When the allowance starts again. */
export function nextMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Records one finished stretch. Called wherever a VM stops running (lib/sandbox). */
export async function recordVmStretch(input: {
  userId: number;
  agentId: string;
  startedAt: Date;
  endedAt: Date;
  seconds: number;
}) {
  if (input.seconds <= 0) return;
  await db.insert(vmUsage).values(input);
}

/** Seconds of VM time this user has used this month, including VMs running now. */
export async function vmSecondsThisMonth(userId: number, now = new Date()) {
  const [done] = await db
    .select({ total: sql<number>`coalesce(sum(${vmUsage.seconds}), 0)::int` })
    .from(vmUsage)
    .where(and(eq(vmUsage.userId, userId), gte(vmUsage.endedAt, monthStart(now))));

  // Stretches still going: from when they began (or the month began) to now.
  const [live] = await db
    .select({
      total: sql<number>`coalesce(sum(extract(epoch from (${now.toISOString()}::timestamptz - greatest(${sandboxes.runningSince}, ${monthStart(now).toISOString()}::timestamptz)))), 0)::int`,
    })
    .from(sandboxes)
    .where(and(eq(sandboxes.userId, userId), eq(sandboxes.status, "running")));

  return (done?.total ?? 0) + Math.max(0, live?.total ?? 0);
}

export type VmBudget = { usedSeconds: number; allowanceSeconds: number; leftSeconds: number; resetsAt: Date };

export async function vmBudget(userId: number): Promise<VmBudget> {
  const allowanceSeconds = vmAllowanceSeconds(userId);
  const usedSeconds = await vmSecondsThisMonth(userId);
  return {
    usedSeconds,
    allowanceSeconds,
    leftSeconds: Math.max(0, allowanceSeconds - usedSeconds),
    resetsAt: nextMonthStart(),
  };
}

/** What to tell someone whose VM time is used up. */
export function vmCapMessage(budget: VmBudget) {
  const minutes = Math.round(budget.allowanceSeconds / 60);
  const when = budget.resetsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `You've used your ${minutes} minutes of VM time this month. It resets on ${when}; upgrade your plan for more.`;
}
