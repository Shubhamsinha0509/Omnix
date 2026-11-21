/**
 * How a run's pieces are executed — the one difference between a chat turn and a
 * background task run (decision D41).
 *
 * The agent loop is the same code either way (D9). What changes is that a background run
 * wraps each model call and each tool call in an Inngest step: if the eleventh tool call
 * fails, Inngest retries that call rather than starting the run again from the top, and a
 * worker that dies mid-run picks up where it left off instead of re-reading a mailbox and
 * re-sending an email.
 *
 * Nothing here imports Inngest. The runner only knows "wrap this unit of work"; the
 * Inngest function supplies the wrapper (`lib/inngest/tasks.ts`).
 */

export type Durability = {
  /**
   * Runs one unit of work under a stable id, which is also its memoisation key.
   *
   * The id has to be the same on every pass through the same run, and the result has to
   * survive `JSON.stringify` — on a later pass the work is not run again, its stored
   * result is handed back instead.
   */
  step<T>(id: string, work: () => Promise<T>): Promise<T>;
  /**
   * True when a step's result may come back from memory rather than from running.
   *
   * It is what the runner needs in order to know that side effects *outside* a step
   * (streaming text to a browser, counting it up) can't be trusted to have happened:
   * with this set, the run's reply is built from each step's stored result instead.
   */
  memoised: boolean;
};

/** Chat: one HTTP request, everything runs now, nothing is replayed. */
export const immediate: Durability = {
  step: (_id, work) => work(),
  memoised: false,
};

/** An action a run has stopped on, as the thing that waits for a decision sees it. */
export type PendingDecision = {
  approvalId: string;
  tool: string;
  summary: string;
  /** ISO 8601. 24 hours after the card was created. */
  expiresAt: string;
};

/**
 * What a background run does when the agent asks permission: wait for the answer.
 *
 * Chat has no waiter — an HTTP request can't sit for a day, so the turn stops and a
 * second request resumes it (D35). A background run is already durable, so it waits on
 * the decision event and carries straight on, which is the whole difference between
 * "approve, and the agent finishes the job" and "approve, and nothing else happens".
 *
 * `expired` means nobody answered inside the window, and is told to the model as a
 * refusal — the agent gets to finish and say what it couldn't do.
 */
export type ApprovalGate = (pending: PendingDecision) => Promise<"approved" | "rejected" | "expired">;
