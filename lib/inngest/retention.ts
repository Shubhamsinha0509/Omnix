import { purgeStepPayloadsBefore } from "@/lib/agent/runs";
import { purgeSharedFilesBefore } from "@/lib/files";
import { purgeNotificationsBefore } from "@/lib/notifications";
import { inngest } from "./client";

/**
 * How long content read from someone's account is kept (decision D43).
 *
 * A run step's payload is the email the agent read, the page it fetched, the draft it
 * wrote. Keeping that for ever is a liability with no use: by the time anybody is
 * debugging a run from six weeks ago, what they need is which tools ran and whether they
 * worked, and those rows stay.
 */
export const RETENTION = {
  /** After this, a step keeps its shape and loses its contents. */
  stepPayloadDays: 30,
  /** After this, a notification is deleted outright — it is a copy of a delivered result. */
  notificationDays: 90,
};

const DAY_MS = 86_400_000;

/**
 * The nightly sweep. Deliberately boring and idempotent: it only ever clears things that
 * are past their window, so running it twice does nothing the second time.
 */
export const retentionSweep = inngest.createFunction(
  { id: "retention-sweep", name: "Forget old run contents", retries: 1, concurrency: 1 },
  // 04:10 UTC: away from the hours when users' own tasks tend to be scheduled.
  { cron: "10 4 * * *" },
  async ({ step }) => {
    const steps = await step.run("purge-step-payloads", () =>
      purgeStepPayloadsBefore(new Date(Date.now() - RETENTION.stepPayloadDays * DAY_MS)),
    );

    const notifications = await step.run("purge-notifications", () =>
      purgeNotificationsBefore(new Date(Date.now() - RETENTION.notificationDays * DAY_MS)),
    );

    // Files agents shared from their VMs are run contents too: same window as the steps.
    const files = await step.run("purge-shared-files", () =>
      purgeSharedFilesBefore(new Date(Date.now() - RETENTION.stepPayloadDays * DAY_MS)),
    );

    return { stepPayloadsCleared: steps, notificationsDeleted: notifications, sharedFilesDeleted: files };
  },
);
