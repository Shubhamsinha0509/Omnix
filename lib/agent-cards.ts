import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { formatDistanceToNowStrict, isToday, format } from "date-fns";

import { agents, db, runs, tasks } from "@/db";
import { describeSchedule } from "@/lib/schedule/cron";
import type { AgentCardData } from "@/components/custom/design/AgentCard";

/** A run still in progress — what makes an agent "Running". */
const LIVE = ["queued", "running", "waiting_approval"] as const;

const elapsed = (from: Date, now: Date) => {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

const ago = (date: Date) =>
  formatDistanceToNowStrict(date, { addSuffix: true })
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ seconds?/, "s");

/**
 * Every agent the user has, as the cards on Home and Agents show them:
 * - **Draft**: no instructions yet.
 * - **Running**: a run is in progress (subtitle: elapsed time).
 * - **Paused**: it has tasks, and every one is switched off.
 * - **Active**: anything else (subtitle: last run, else its schedule, else when created).
 */
export async function listAgentCards(userId: number, limit?: number): Promise<AgentCardData[]> {
  const base = db
    .select({
      id: agents.id,
      name: agents.name,
      avatarSeed: agents.avatarSeed,
      instructions: agents.instructions,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .where(eq(agents.userId, userId))
    .orderBy(desc(agents.createdAt));
  const rows = limit ? await base.limit(limit) : await base;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [latestRuns, liveRuns, taskRows] = await Promise.all([
    // The most recent run of each agent.
    db
      .selectDistinctOn([runs.agentId], { agentId: runs.agentId, startedAt: runs.startedAt })
      .from(runs)
      .where(and(eq(runs.userId, userId), inArray(runs.agentId, ids)))
      .orderBy(runs.agentId, desc(runs.startedAt)),
    // Runs in progress (older than a day is a run that died without finishing; ignore it).
    db
      .select({ id: runs.id, agentId: runs.agentId, startedAt: runs.startedAt })
      .from(runs)
      .where(
        and(
          eq(runs.userId, userId),
          inArray(runs.agentId, ids),
          inArray(runs.status, [...LIVE]),
          sql`${runs.startedAt} > now() - interval '1 day'`,
        ),
      )
      .orderBy(desc(runs.startedAt)),
    db
      .select({
        agentId: tasks.agentId,
        enabled: tasks.enabled,
        trigger: tasks.trigger,
        schedule: tasks.schedule,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.agentId, ids)))
      .orderBy(tasks.createdAt),
  ]);

  const now = new Date();
  const lastRun = new Map(latestRuns.map((run) => [run.agentId, run.startedAt]));
  const live = new Map<string, { id: string; startedAt: Date }>();
  for (const run of liveRuns) if (!live.has(run.agentId)) live.set(run.agentId, run);

  return rows.map((agent) => {
    const card = {
      id: agent.id,
      name: agent.name,
      avatarSeed: agent.avatarSeed,
      instructions: agent.instructions.trim(),
    };
    const created = isToday(agent.createdAt)
      ? "Created today"
      : `Created ${format(agent.createdAt, "MMM d")}`;

    if (!card.instructions) return { ...card, status: "draft", subtitle: created };

    const running = live.get(agent.id);
    if (running) {
      return {
        ...card,
        status: "running",
        subtitle: `Running · ${elapsed(running.startedAt, now)}`,
        runHref: `/workspace/agent/${agent.id}/runs/${running.id}`,
      };
    }

    const own = taskRows.filter((task) => task.agentId === agent.id);
    const scheduled = own.find((task) => task.enabled && task.trigger === "schedule" && task.schedule);
    if (own.length > 0 && own.every((task) => !task.enabled)) {
      const was = own.find((task) => task.schedule);
      return {
        ...card,
        status: "paused",
        subtitle: was?.schedule ? `Paused · was ${describeSchedule(was.schedule).toLowerCase()}` : "Paused",
      };
    }

    const last = lastRun.get(agent.id);
    const subtitle = last
      ? `Last run ${ago(last)}`
      : scheduled?.schedule
        ? describeSchedule(scheduled.schedule)
        : created;
    return { ...card, status: "active", subtitle };
  });
}
