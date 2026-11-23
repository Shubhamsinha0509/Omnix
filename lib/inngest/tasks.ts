import { eq } from "drizzle-orm";

import { db, users, type Agent, type Task, type User } from "@/db";
import { expireOverdue, getApproval } from "@/lib/agent/approvals";
import type { Durability } from "@/lib/agent/durability";
import { runAgent } from "@/lib/agent/runner";
import { deliverTaskResult } from "@/lib/delivery";
import { notify } from "@/lib/notifications";
import {
  TASK_LIMITS,
  claimDueTasks,
  countBackgroundRunsToday,
  getTaskWithAgent,
  markTaskStarted,
} from "@/lib/tasks";
import { inngest, taskRunEventId } from "./client";

/**
 * Background runs: an agent working without anybody watching.
 *
 * Two functions, and the split matters. The **scheduler** only decides *what* is due and
 * says so; the **runner** does one task's work. That way a task that takes four minutes
 * or waits a day for an approval can't hold up the minute tick, and a task that fails is
 * retried on its own.
 *
 * Everything inside a run is a durable step (D41): each model call, each tool call, each
 * decision. Inngest remembers the ones that finished, so a worker that dies halfway
 * through is picked up where it stopped rather than re-reading a mailbox and re-sending
 * an email it already sent.
 */

/**
 * How a parked run waits for its answer: a short wait, repeated, with the approval row
 * read in between. Together these cover the row's own 24-hour window (D41).
 */
const APPROVAL_WAIT = "1h";
const APPROVAL_WAITS = 24;

/**
 * What the approval row says, or null while it is still pending and in date.
 *
 * This — not the event — is what a waiting run acts on, so a decision whose event was
 * lost is still carried out. A row that has gone, or whose window has closed, counts as
 * expired, and any of the user's other overdue cards are marked so at the same time.
 */
async function decisionFromRow(userId: number, approvalId: string) {
  const row = await getApproval(userId, approvalId);
  if (row?.status === "approved") return "approved" as const;
  if (row?.status === "rejected") return "rejected" as const;
  if (row && row.expiresAt.getTime() > Date.now()) return null;

  await expireOverdue(userId);
  return "expired" as const;
}

/**
 * The clock. Once a minute it asks the database which tasks are due, claims each one and
 * sends an event per claim.
 *
 * The cron is fixed and the schedules are not: a user's "every weekday at 9:00" lives in
 * a row, in their timezone, and Inngest's own cron can't read that (decision D40). The
 * due arithmetic is in `lib/schedule/cron.ts`, the claim in `lib/tasks.ts`.
 */
export const taskScheduler = inngest.createFunction(
  {
    id: "task-scheduler",
    name: "Scheduler: fan out due agent tasks",
    // One tick at a time. Two overlapping ticks would be safe — the claim decides — but
    // there is nothing to gain from them.
    concurrency: 1,
    retries: 1,
  },
  { cron: "* * * * *" },
  async ({ step }) => {
    const claimed = await step.run("claim-due-tasks", async () =>
      (await claimDueTasks()).map((task) => ({ id: task.id, dueAt: task.dueAt.toISOString() })),
    );

    if (claimed.length === 0) return { due: 0 };

    // The event id is the task plus the due time, so the same due time can never be
    // queued twice — a retried tick, or two schedulers, still runs each task once.
    await step.sendEvent(
      "start-due-tasks",
      claimed.map((task) => ({
        id: taskRunEventId(task.id, new Date(task.dueAt)),
        name: "agent/task.run" as const,
        data: { taskId: task.id, trigger: "schedule" as const, dueAt: task.dueAt },
      })),
    );

    return { due: claimed.length, tasks: claimed.map((task) => task.id) };
  },
);

/**
 * One task run, start to finish: the agent works, the result is delivered.
 *
 * One run per task at a time. A second run of the same task — a "Run now" during a
 * scheduled run, or the next scheduled run while this one is still going — is queued
 * rather than started alongside, so a task can't overlap itself and read the same inbox
 * twice. The consequence is deliberate: a run parked on a 24-hour approval holds its
 * task's queue until it is answered or expires. What protects the spend across *all*
 * tasks is the daily cap below, not this.
 */
export const runTask = inngest.createFunction(
  {
    id: "agent-task-run",
    name: "Run an agent task",
    retries: 2,
    concurrency: { key: "event.data.taskId", limit: 1 },
  },
  { event: "agent/task.run" },
  async ({ event, step }) => {
    const { taskId, trigger } = event.data;

    /**
     * What this run works from, read **once** and remembered for its whole life.
     *
     * It has to be one decision, not one per pass. Inngest re-executes this function body
     * at every step boundary, so a check made out here would be remade against whatever
     * the row says later — and a task paused or deleted while its run was in flight (or
     * parked on a 24-hour approval) would abandon that run half way: its `runs` row left
     * `running` for ever, nothing delivered, and an action the user had already approved
     * never carried out. Memoised, a run that has started always finishes.
     */
    const snapshot = await step.run("load-task", async () => {
      const loaded = await getTaskWithAgent(taskId);
      if (!loaded) return { skip: "task_deleted" as const };

      const [found] = await db.select().from(users).where(eq(users.id, loaded.task.userId)).limit(1);
      if (!found) return { skip: "user_deleted" as const };

      // "Run now" runs a disabled task deliberately; the schedule does not.
      if (trigger === "schedule" && !loaded.task.enabled) return { skip: "task_disabled" as const };

      return { skip: null, task: loaded.task, agent: loaded.agent, user: found };
    });

    if (snapshot.skip) return { skipped: snapshot.skip };

    // A step's result has been through JSON, so the rows' instants come back as strings.
    const task: Task = {
      ...snapshot.task,
      nextRunAt: snapshot.task.nextRunAt ? new Date(snapshot.task.nextRunAt) : null,
      lastRunAt: snapshot.task.lastRunAt ? new Date(snapshot.task.lastRunAt) : null,
      createdAt: new Date(snapshot.task.createdAt),
      updatedAt: new Date(snapshot.task.updatedAt),
    };
    const agent: Agent = { ...snapshot.agent, createdAt: new Date(snapshot.agent.createdAt) };
    const user: User = { ...snapshot.user, createdAt: new Date(snapshot.user.createdAt) };

    /**
     * The budget backstop (D45). Unattended runs spend money with nobody watching, so
     * past the daily cap the run is skipped and the user is told — once, in the step, so
     * a retry doesn't fill their inbox.
     */
    const overBudget = await step.run("check-daily-limit", async () => {
      const used = await countBackgroundRunsToday(task.userId);
      if (used < TASK_LIMITS.maxRunsPerDay) return null;

      await notify({
        userId: user.id,
        kind: "task_failed",
        title: `${task.name} was skipped`,
        body:
          `Your agents have already made ${used} background runs in the last 24 hours, which is the ` +
          `limit of ${TASK_LIMITS.maxRunsPerDay}. This run was skipped. Turn some tasks off or make them ` +
          "less frequent, and it will run again at its next scheduled time.",
        agentId: agent.id,
        taskId: task.id,
      });
      return { used };
    });
    if (overBudget) return { skipped: "daily_limit", used: overBudget.used };

    await step.run("mark-task-started", async () => {
      await markTaskStarted(task.id);
      return null;
    });

    /**
     * Each model call and tool call as its own Inngest step.
     *
     * The cast is the one place the two type worlds meet: Inngest describes a step's
     * result as JSON (it has been through a serialiser), while the runner asked for the
     * type it returned. Everything we put in a step is plain data for exactly this
     * reason — see `CallOutcome` in the runner, which carries a tool's key rather than
     * the tool.
     */
    const durability: Durability = {
      step: (id, work) => step.run(id, work) as Promise<never>,
      memoised: true,
    };

    /** Notes aren't part of the reply, but they say why a run stopped early. */
    const notes: string[] = [];

    const outcome = await runAgent({
      agent,
      user,
      trigger: trigger === "manual" ? "manual" : "schedule",
      taskId: task.id,
      conversationId: null,
      history: [{ role: "user", content: task.prompt }],
      timezone: task.timezone,
      // Nothing cancels a background run from outside: its bounds are the runner's own
      // limits (tool timeouts, iterations) and Inngest's retries.
      signal: new AbortController().signal,
      emit: (runEvent) => {
        if (runEvent.t === "note" && !notes.includes(runEvent.v)) notes.push(runEvent.v);
      },
      durability,

      /**
       * The agent asked permission. Tell the user, then wait — for up to 24 hours, with
       * nothing held open — and hand back what they decided.
       *
       * The **row** is the authority, not the event. The notification is written in one
       * request and this wait is registered in the next, so a decision made in between
       * sends an event with nothing listening for it yet; a send that fails outright
       * (the route's 502) sends none at all. Either way the answer is already in the
       * row, so it is read before every wait, and each wait is short enough that a lost
       * event costs an hour rather than the whole day.
       */
      awaitApproval: async (pending) => {
        await step.run(`notify-approval-${pending.approvalId}`, async () => {
          await notify({
            userId: user.id,
            kind: "approval_request",
            title: `${agent.name} needs your approval`,
            body: `While running "${task.name}": ${pending.summary}`,
            agentId: agent.id,
            taskId: task.id,
            approvalId: pending.approvalId,
          });
          return null;
        });

        for (let attempt = 0; attempt < APPROVAL_WAITS; attempt++) {
          const decided = await step.run(`approval-state-${pending.approvalId}-${attempt}`, () =>
            decisionFromRow(user.id, pending.approvalId),
          );
          if (decided) return decided;

          // The event is the fast path: it ends this wait the moment the user clicks.
          await step.waitForEvent(`wait-approval-${pending.approvalId}-${attempt}`, {
            event: "approval/decided",
            timeout: APPROVAL_WAIT,
            if: `async.data.approvalId == "${pending.approvalId}"`,
          });
        }

        // The whole window has gone by. One last look at the row before giving up on it.
        return step.run(`approval-timeout-${pending.approvalId}`, async () => {
          const decided = await decisionFromRow(user.id, pending.approvalId);
          if (decided) return decided;
          await expireOverdue(user.id);
          return "expired" as const;
        });
      },
    });

    const ok = outcome.status === "succeeded";

    const delivered = await step.run("deliver-result", () =>
      deliverTaskResult({
        user,
        agent,
        task,
        runId: outcome.runId,
        reply: outcome.reply,
        notes,
        ok,
        error: outcome.error ?? null,
      }),
    );

    return { runId: outcome.runId, status: outcome.status, delivered };
  },
);
