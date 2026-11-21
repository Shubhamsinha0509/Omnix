import { and, count, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { agents, db, runs, tasks, type Agent, type Task } from "@/db";
import { TASK_LIMITS, type DeliveryChannel } from "@/lib/agent-limits";
import { UUID_PATTERN } from "@/lib/agents";
import { nextOccurrence } from "@/lib/schedule/cron";

// The limits and the delivery channels are also used by the task form in the browser, so
// they live in `lib/agent-limits.ts` — a module with no database in it — and are
// re-exported here, which is where the server-side code looks for them.
export { DELIVERY_CHANNELS, TASK_LIMITS, type DeliveryChannel } from "@/lib/agent-limits";

/**
 * Tasks: what an agent does without being asked.
 *
 * Everything about *when* a task runs is reduced to one column, `next_run_at`, so the
 * scheduler's job is a single indexed query and no cron arithmetic (decision D40). The
 * cron expression is only read here, when the task changes and when a run is claimed.
 */

export type TaskInput = {
  name: string;
  prompt: string;
  trigger: "manual" | "schedule";
  /** Five-field cron, read in `timezone`. Required for `schedule`, ignored for `manual`. */
  schedule: string | null;
  timezone: string;
  deliver: DeliveryChannel[];
  enabled: boolean;
};

/** A task plus how its last run went. */
export type TaskSummary = Task & {
  /** The last run of this task, for "last run: 2 hours ago, succeeded". */
  lastStatus: string | null;
  lastRunId: string | null;
};

/**
 * A task as the browser gets it: instants as ISO strings.
 *
 * The type is here rather than in the component so the page can build it without
 * importing a client module — and the component imports it with `import type`, which is
 * erased, so none of this file's database code goes near the browser.
 */
export type TaskView = {
  id: string;
  name: string;
  prompt: string;
  trigger: "manual" | "schedule";
  schedule: string | null;
  timezone: string;
  deliver: string[];
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastRunId: string | null;
};

export function toTaskView(task: TaskSummary): TaskView {
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    trigger: task.trigger,
    schedule: task.schedule,
    timezone: task.timezone,
    deliver: task.deliver,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    lastStatus: task.lastStatus,
    lastRunId: task.lastRunId,
  };
}

/**
 * When this task should next run, or null if it never should.
 *
 * Null is a real answer, not a failure: a manual task has no schedule, a disabled task
 * has no next run, and `0 12 31 2 *` can never happen. The scheduler only ever looks for
 * rows with a non-null time in the past, so null simply means "not waiting on the clock".
 */
export function computeNextRun(
  task: Pick<Task, "trigger" | "schedule" | "timezone" | "enabled">,
  after: Date = new Date(),
) {
  if (!task.enabled || task.trigger !== "schedule" || !task.schedule) return null;
  return nextOccurrence(task.schedule, task.timezone, after);
}

/** An agent's tasks, newest first, each with how its last run went. */
export async function listTasks(agentId: string, userId: number): Promise<TaskSummary[]> {
  if (!UUID_PATTERN.test(agentId)) return [];

  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.agentId, agentId), eq(tasks.userId, userId)))
    .orderBy(desc(tasks.createdAt));

  if (rows.length === 0) return [];

  /**
   * The most recent run of each of those tasks: one row per task, not every run of each.
   *
   * `DISTINCT ON` does the picking in Postgres, against `runs_task_started_idx`. Reading
   * them all and taking the first in JavaScript worked, but runs are kept for ever (D43)
   * and a task that has run nightly for a year has hundreds — and this query is on the
   * agent's chat page as well as the Tasks tab.
   */
  const latest = await db
    .selectDistinctOn([runs.taskId], { id: runs.id, taskId: runs.taskId, status: runs.status })
    .from(runs)
    .where(
      and(
        eq(runs.userId, userId),
        inArray(
          runs.taskId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(runs.taskId, desc(runs.startedAt));

  const byTask = new Map<string, { id: string; status: string }>();
  for (const run of latest) {
    if (run.taskId) byTask.set(run.taskId, { id: run.id, status: run.status });
  }

  return rows.map((row) => ({
    ...row,
    lastStatus: byTask.get(row.id)?.status ?? null,
    lastRunId: byTask.get(row.id)?.id ?? null,
  }));
}

/** The task with this id, but only if the given user owns it. */
export async function getOwnedTask(userId: number, taskId: string) {
  if (!UUID_PATTERN.test(taskId)) return null;
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  return task ?? null;
}

/** The task plus the agent that runs it — what a background run needs to start. */
export async function getTaskWithAgent(taskId: string): Promise<{ task: Task; agent: Agent } | null> {
  if (!UUID_PATTERN.test(taskId)) return null;

  const [row] = await db
    .select({ task: tasks, agent: agents })
    .from(tasks)
    .innerJoin(agents, eq(tasks.agentId, agents.id))
    .where(eq(tasks.id, taskId))
    .limit(1);

  return row ?? null;
}

export async function countTasks(agentId: string) {
  const [row] = await db.select({ total: count() }).from(tasks).where(eq(tasks.agentId, agentId));
  return row?.total ?? 0;
}

export async function createTask(agent: Agent, input: TaskInput) {
  const [task] = await db
    .insert(tasks)
    .values({
      agentId: agent.id,
      userId: agent.userId,
      name: input.name,
      prompt: input.prompt,
      trigger: input.trigger,
      schedule: input.trigger === "schedule" ? input.schedule : null,
      timezone: input.timezone,
      deliver: input.deliver,
      enabled: input.enabled,
      nextRunAt: computeNextRun({ ...input, schedule: input.schedule }),
    })
    .returning();
  return task;
}

/**
 * Saves a task and recomputes when it next runs.
 *
 * The next run is always computed from *now*, never advanced from the old value: editing
 * "every day at 9" to "every day at 10" should mean the next 10:00, and a task re-enabled
 * after a week off should not fire once for every day it was off.
 */
export async function updateTask(taskId: string, userId: number, input: TaskInput) {
  const [task] = await db
    .update(tasks)
    .set({
      name: input.name,
      prompt: input.prompt,
      trigger: input.trigger,
      schedule: input.trigger === "schedule" ? input.schedule : null,
      timezone: input.timezone,
      deliver: input.deliver,
      enabled: input.enabled,
      nextRunAt: computeNextRun(input),
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();
  return task ?? null;
}

/** Turning a task off stops the clock; turning it on starts it from the next due time. */
export async function setTaskEnabled(taskId: string, userId: number, enabled: boolean) {
  const task = await getOwnedTask(userId, taskId);
  if (!task) return null;

  const [updated] = await db
    .update(tasks)
    .set({ enabled, nextRunAt: computeNextRun({ ...task, enabled }), updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteTask(taskId: string, userId: number) {
  const [deleted] = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning({ id: tasks.id });
  return Boolean(deleted);
}

/** A task the scheduler has taken responsibility for running once. */
export type ClaimedTask = { id: string; dueAt: Date };

/**
 * Claims every task whose time has come, and moves each one's clock forward.
 *
 * The claim is a conditional `UPDATE` per task — "set the next run forward, but only if
 * it is still the time I read" — so two schedulers ticking at once, or a cron that fires
 * twice, cannot both claim the same due time. Only the update that changes the row wins,
 * and that one sends the event.
 *
 * The new time is computed from **now**, not from the due time, so a server that was down
 * for a day comes back and runs each task once rather than catching up on 24 missed runs.
 */
export async function claimDueTasks(limit = 100): Promise<ClaimedTask[]> {
  const now = new Date();

  const due = await db
    .select({ id: tasks.id, nextRunAt: tasks.nextRunAt, schedule: tasks.schedule, timezone: tasks.timezone })
    .from(tasks)
    .where(
      and(
        eq(tasks.enabled, true),
        eq(tasks.trigger, "schedule"),
        isNotNull(tasks.nextRunAt),
        lte(tasks.nextRunAt, now),
      ),
    )
    .orderBy(tasks.nextRunAt)
    .limit(limit);

  const claimed: ClaimedTask[] = [];

  for (const task of due) {
    if (!task.nextRunAt || !task.schedule) continue;
    const following = nextOccurrence(task.schedule, task.timezone, now);

    const [won] = await db
      .update(tasks)
      .set({ nextRunAt: following, updatedAt: now })
      .where(and(eq(tasks.id, task.id), eq(tasks.nextRunAt, task.nextRunAt)))
      .returning({ id: tasks.id });

    if (won) claimed.push({ id: task.id, dueAt: task.nextRunAt });
  }

  return claimed;
}

/** Records that a task has just started a run, for "last run" in the Tasks tab. */
export async function markTaskStarted(taskId: string, at: Date = new Date()) {
  await db.update(tasks).set({ lastRunAt: at }).where(eq(tasks.id, taskId));
}

/**
 * Background runs this user has started in the last 24 hours, for the daily cap.
 *
 * Chat runs don't count: the user is sitting there, and stopping them would break the app
 * rather than protect the budget.
 */
export async function countBackgroundRunsToday(userId: number) {
  const [row] = await db
    .select({ total: count() })
    .from(runs)
    .where(
      and(
        eq(runs.userId, userId),
        inArray(runs.trigger, ["schedule", "manual"]),
        gte(runs.startedAt, sql`now() - interval '24 hours'`),
      ),
    );
  return row?.total ?? 0;
}
