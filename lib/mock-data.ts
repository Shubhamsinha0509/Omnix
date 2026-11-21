/**
 * MOCK DATA for parts of the redesign that have no backend yet.
 *
 * Every export here is a stand-in, typed the way the real data will be, so a screen can
 * switch to a query without changing its markup. Search for "TODO(backend)" to find what
 * each one is waiting on. Nothing in this file is read by the agent runner or the API.
 */

/** TODO(backend): token metering per user per month (docs/08-roadmap.md, Phase 7). */
export type UsageSummary = {
  plan: "Free" | "Pro";
  /** Share of this month's token allowance used, 0–100. */
  tokensUsedPercent: number;
};

export const MOCK_USAGE: UsageSummary = {
  plan: "Free",
  tokensUsedPercent: 12,
};
