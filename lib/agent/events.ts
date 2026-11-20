/**
 * The wire format between the chat API route and the browser.
 *
 * Phase 1 streamed plain text. A reply can now also contain tool activity ("Searching
 * the web…") and a request for the user's approval, so the stream carries one JSON object
 * per line instead (decision D23). Only `text` events are saved to the conversation —
 * notes and activity are for this turn only, so the model never sees them in its history.
 * An approval is the exception: it outlives the stream, in the `approvals` table, because
 * the user may well come back to it tomorrow.
 */
export type RunEvent =
  /** A piece of the agent's reply. */
  | { t: "text"; v: string }
  /** A tool the agent is using, or has finished using. */
  | { t: "activity"; id: string; tool: string; label: string; status: ActivityStatus; detail?: string }
  /** Something the user should know that isn't part of the reply (an error, a limit hit). */
  | { t: "note"; v: string }
  /** The agent wants to do something the user has to agree to first. The turn stops here. */
  | { t: "approval"; v: ApprovalRequest };

/**
 * An action waiting for a decision, as the chat draws it.
 *
 * `details` holds the real values — the actual recipient, subject and body — because a
 * card showing the agent's description of what it is about to do is no defence at all
 * (docs/07-security.md).
 */
export type ApprovalRequest = {
  id: string;
  tool: string;
  /** "Sending email" — the tool's own label, so the card matches the activity line. */
  label: string;
  summary: string;
  details: { label: string; value: string }[];
  expiresAt: string;
  /**
   * False when the paused turn was too large to store: approving still performs the
   * action, but the agent stops there instead of carrying on with the result.
   */
  resumable: boolean;
};

/** What the chat shows once a card has been acted on. */
export type ApprovalDecision = "approved" | "rejected" | "expired";

export type ActivityStatus = "running" | "done" | "error";

/** What the chat shows for one tool call. */
export type Activity = {
  id: string;
  tool: string;
  label: string;
  status: ActivityStatus;
  detail?: string;
};

export const RUN_STREAM_CONTENT_TYPE = "application/x-ndjson";

export function encodeEvent(event: RunEvent) {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Turns stream chunks into events. A chunk can split a line in half, so whatever is
 * left over after the last newline is held back until the rest arrives.
 */
export function createEventParser() {
  let buffer = "";

  return function parse(chunk: string): RunEvent[] {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    const events: RunEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as RunEvent);
      } catch {
        // A malformed line would be a bug on our side; dropping it beats breaking the chat.
      }
    }
    return events;
  };
}
