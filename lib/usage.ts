import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { cache } from "react";

import { agents, db, runSteps, runs } from "@/db";

/** The first instant of this calendar month (server time), and of the next. */
export function monthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, next };
}

export type MonthlyUsage = {
  tokens: number;
  webSearches: number;
  byAgent: { id: string; name: string; avatarSeed: string; tokens: number }[];
  resetsAt: Date;
};

/**
 * What the user has used this month, from the run log: tokens per run (input + output)
 * and web searches (each `web.search` call). Cached per render, so the sidebar and the
 * Usage page share one read.
 */
export const getMonthlyUsage = cache(async function getMonthlyUsage(userId: number): Promise<MonthlyUsage> {
  const { start, next } = monthBounds();
  const tokens = sql<number>`coalesce(sum(${runs.inputTokens} + ${runs.outputTokens}), 0)::int`;

  const [byAgent, [searches]] = await Promise.all([
    db
      .select({ id: agents.id, name: agents.name, avatarSeed: agents.avatarSeed, tokens })
      .from(runs)
      .innerJoin(agents, eq(runs.agentId, agents.id))
      .where(and(eq(runs.userId, userId), gte(runs.startedAt, start)))
      .groupBy(agents.id, agents.name, agents.avatarSeed)
      .orderBy(desc(tokens)),
    db
      .select({ total: count() })
      .from(runSteps)
      .innerJoin(runs, eq(runSteps.runId, runs.id))
      .where(
        and(
          eq(runs.userId, userId),
          gte(runs.startedAt, start),
          eq(runSteps.type, "tool_call"),
          eq(runSteps.tool, "web.search"),
        ),
      ),
  ]);

  return {
    tokens: byAgent.reduce((sum, agent) => sum + Number(agent.tokens), 0),
    webSearches: searches?.total ?? 0,
    byAgent: byAgent.map((agent) => ({ ...agent, tokens: Number(agent.tokens) })),
    resetsAt: next,
  };
});
