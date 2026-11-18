/**
 * The wire format between the chat API route and the browser.
 *
 * Phase 1 streamed plain text. A reply can now also contain tool activity ("Searching
 * the web…"), so the stream carries one JSON object per line instead (decision D23).
 * Only `text` events are saved to the conversation — notes and activity are for this
 * turn only, so the model never sees them in its history.
 */
export type RunEvent =
  /** A piece of the agent's reply. */
  | { t: "text"; v: string }
  /** A tool the agent is using, or has finished using. */
  | { t: "activity"; id: string; tool: string; label: string; status: ActivityStatus; detail?: string }
  /** Something the user should know that isn't part of the reply (an error, a limit hit). */
  | { t: "note"; v: string };

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
