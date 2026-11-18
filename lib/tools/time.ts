import type { ToolDefinition } from "./types";

/** Does this look like a real IANA timezone? Intl throws on anything it doesn't know. */
function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The model has no clock: its idea of "today" comes from training data. Without this,
 * anything about dates ("next Tuesday", "is this invoice overdue?") is a guess.
 */
export const timeNow: ToolDefinition = {
  key: "time.now",
  label: "Checking the time",
  description:
    "Get the current date and time. Use this whenever the answer depends on today's date, " +
    "the day of the week, or the current time — never guess them. Defaults to the user's own timezone.",
  risk: "read",
  runsIn: "server",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          'IANA timezone name, e.g. "Europe/London" or "America/New_York". ' +
          "Leave this out to use the user's timezone.",
        maxLength: 64,
      },
    },
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const requested = typeof args.timezone === "string" ? args.timezone.trim() : "";
    const timezone = requested || ctx.timezone;

    if (requested && !isValidTimezone(requested)) {
      return { error: `"${requested}" isn't a known timezone. Use an IANA name like "Europe/London".` };
    }

    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(now);

    return {
      output: {
        timezone,
        local: parts,
        iso: now.toISOString(),
        weekday: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long" }).format(now),
        date: new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now), // YYYY-MM-DD
      },
    };
  },
};
