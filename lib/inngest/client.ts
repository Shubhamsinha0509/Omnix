import { EventSchemas, Inngest } from "inngest";

/**
 * Every event Omnix sends, declared once so both ends are typed.
 *
 * - `agent/task.run` — a task is due (from the minute scheduler) or the user pressed
 *   "Run now". `dueAt` is the scheduled time it is standing in for, and is also what
 *   makes the event's own id unique per due time, so a cron that fires twice runs once.
 * - `approval/decided` — the user answered an approval card. A background run is parked
 *   on `step.waitForEvent` for exactly this, which is what lets it carry on afterwards
 *   instead of just ending (decision D41).
 */
type OmnixEvents = {
  "agent/task.run": {
    data: { taskId: string; trigger: "schedule" | "manual"; dueAt?: string };
  };
  "approval/decided": {
    data: { approvalId: string; decision: "approved" | "rejected" };
  };
};

export const inngest = new Inngest({
  id: "omnix",
  schemas: new EventSchemas().fromRecord<OmnixEvents>(),
  eventKey: process.env.INNGEST_EVENT_KEY,
});

/** The event id for a scheduled run, so the same due time can only be queued once. */
export function taskRunEventId(taskId: string, dueAt: Date) {
  return `task-${taskId}-${dueAt.toISOString()}`;
}
