/**
 * Limits used by a form in the browser *and* checked again on the server.
 *
 * They live here, not in the "use client" form component, because a server module that
 * imports from a client module gets client references instead of the values — the
 * server-side length checks would silently compare against something that isn't a number.
 */
export const MAX_AGENT_NAME = 60;
export const MAX_AGENT_INSTRUCTIONS = 1000;

/** Limits on a task. The form shows them; `saveTask` enforces them again. */
export const TASK_LIMITS = {
  maxName: 80,
  maxPrompt: 4_000,
  /** Per agent. Enough for a working agent, few enough that a loop can't create 10,000. */
  maxPerAgent: 20,
  /**
   * Background runs per user per day, across every agent and task.
   *
   * Unattended runs spend money with nobody watching, and a model budget is still an open
   * question (docs/10-open-questions.md). This is the backstop: past it, scheduled runs
   * are skipped with a note in the user's inbox rather than quietly draining the account.
   */
  maxRunsPerDay: 50,
};

/** Where a task's result is delivered. In-app is a notification row; email is an email. */
export const DELIVERY_CHANNELS = ["inapp", "email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
