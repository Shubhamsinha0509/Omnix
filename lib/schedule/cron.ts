/**
 * Cron, read in the user's timezone.
 *
 * A task's schedule is a five-field cron expression plus an IANA timezone, and the only
 * question we ever ask of it is "when is the next run?" — the answer being an exact
 * instant the scheduler can compare against `now()` (see `lib/tasks.ts`).
 *
 * Why not Inngest's own cron? Inngest supports `TZ=Europe/London 0 9 * * *`, but the
 * schedule is part of the function definition, and ours belongs to a row a user edits.
 * So one Inngest cron ticks every minute and fans out the tasks that are due (D40), and
 * the arithmetic happens here.
 *
 * Everything is computed from the user's wall clock, not the server's: "every weekday at
 * 9:00" means 9:00 where they are, in winter and in summer. The conversion back to an
 * instant is two passes over the zone's offset, which is what makes a DST change land on
 * the right hour instead of an hour early for half the year.
 */

/** One parsed field: the sorted list of values it matches, and whether it was `*`. */
type Field = { values: number[]; wildcard: boolean };

export type CronFields = {
  minutes: Field;
  hours: Field;
  daysOfMonth: Field;
  months: Field;
  daysOfWeek: Field;
};

export type CronParse = { ok: true; fields: CronFields } | { ok: false; error: string };

/**
 * Policy, not arithmetic: a task may run at most four times an hour.
 *
 * `* * * * *` is a valid cron and a way to spend a month's model budget in a day, and
 * every background run costs tokens whether or not anyone reads the result. Four an hour
 * is well inside anything a person actually wants from an agent.
 */
export const MAX_RUNS_PER_HOUR = 4;

const RANGES = {
  minutes: [0, 59],
  hours: [0, 23],
  daysOfMonth: [1, 31],
  months: [1, 12],
  daysOfWeek: [0, 6],
} as const;

const FIELD_NAMES = {
  minutes: "minute",
  hours: "hour",
  daysOfMonth: "day of month",
  months: "month",
  daysOfWeek: "day of week",
} as const;

type FieldName = keyof typeof RANGES;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Parses a five-field cron expression: `minute hour day-of-month month day-of-week`.
 *
 * The supported syntax is a wildcard, a number, a list (`1,15`), a range (`9-17`) and a
 * step written after a slash (every 15 minutes, `9-17/2`). Names (`MON`, `JAN`) are
 * accepted for the two fields that have them, because a user typing an expression by hand
 * will try them. `7` means Sunday, as it has always been allowed to.
 */
export function parseCron(expression: string): CronParse {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, error: "A schedule needs five parts: minute hour day-of-month month day-of-week." };
  }

  const names: FieldName[] = ["minutes", "hours", "daysOfMonth", "months", "daysOfWeek"];
  const fields = {} as CronFields;

  for (const [index, name] of names.entries()) {
    const parsed = parseField(parts[index], name);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    fields[name] = parsed.field;
  }

  return { ok: true, fields };
}

/**
 * Parses and then applies our own rules, which is what every caller that takes a
 * schedule from a user wants: a valid expression that won't run away with the budget.
 */
export function validateSchedule(expression: string): { ok: true; fields: CronFields } | { ok: false; error: string } {
  const parsed = parseCron(expression);
  if (!parsed.ok) return parsed;

  const perHour = parsed.fields.minutes.values.length;
  if (perHour > MAX_RUNS_PER_HOUR) {
    return {
      ok: false,
      error: `That would run ${perHour} times an hour. A task can run at most ${MAX_RUNS_PER_HOUR} times an hour — try every 15 minutes or less often.`,
    };
  }

  return { ok: true, fields: parsed.fields };
}

function parseField(raw: string, name: FieldName): { field: Field } | { error: string } {
  const [min, max] = RANGES[name];
  const label = FIELD_NAMES[name];
  /**
   * `7` is cron's other spelling of Sunday, so it is allowed as a value here and folded
   * to `0` as the values are collected. It cannot be folded any earlier: as the end of a
   * range, `1-7` (Monday to Sunday, which is what people type) would become `1-0` and be
   * rejected, and `0-7` would quietly collapse to Sunday alone.
   */
  const ceiling = name === "daysOfWeek" ? 7 : max;
  const fold = (value: number) => (name === "daysOfWeek" ? value % 7 : value);
  const values = new Set<number>();
  let wildcard = false;

  for (const piece of raw.split(",")) {
    const [spec, stepText, ...rest] = piece.split("/");
    if (rest.length > 0 || stepText === "") return { error: `"${raw}" isn't a valid ${label}.` };

    let step = 1;
    if (stepText !== undefined) {
      step = Number(stepText);
      if (!Number.isInteger(step) || step < 1) return { error: `"${raw}" isn't a valid ${label} step.` };
    }

    let from: number;
    let to: number;

    if (spec === "*") {
      from = min;
      to = max;
      if (step === 1) wildcard = true;
    } else if (spec.includes("-")) {
      const [startText, endText, ...extra] = spec.split("-");
      if (extra.length > 0) return { error: `"${raw}" isn't a valid ${label}.` };
      const start = named(startText, name);
      const end = named(endText, name);
      if (start === null || end === null) return { error: `"${raw}" isn't a valid ${label}.` };
      from = start;
      to = end;
    } else {
      const only = named(spec, name);
      if (only === null) return { error: `"${raw}" isn't a valid ${label}.` };
      from = only;
      to = stepText === undefined ? only : max;
    }

    if (from < min || to > ceiling || from > to) {
      return { error: `A ${label} must be between ${min} and ${ceiling}.` };
    }
    for (let value = from; value <= to; value += step) values.add(fold(value));
  }

  if (values.size === 0) return { error: `"${raw}" isn't a valid ${label}.` };
  return { field: { values: [...values].sort((a, b) => a - b), wildcard } };
}

/** A field value, which may be written as a name (`MON`, `jan`) as well as a number. */
function named(text: string, name: FieldName): number | null {
  const token = text.trim().toLowerCase();
  if (!token) return null;

  if (name === "daysOfWeek") {
    const index = DAY_NAMES.findIndex((day) => day.toLowerCase().startsWith(token) && token.length >= 3);
    if (index >= 0) return index;
  }
  if (name === "months") {
    const index = MONTH_NAMES.findIndex((month) => month.toLowerCase() === token);
    if (index >= 0) return index + 1;
  }

  if (!/^\d+$/.test(token)) return null;
  // `7` for Sunday is left as 7 here and folded in `parseField`, where a range can see it.
  return Number(token);
}

/** Wall-clock fields in some timezone — a calendar date and a time, with no offset. */
type Wall = { year: number; month: number; day: number; hour: number; minute: number };

/**
 * The next instant at which the expression matches, strictly after `after`.
 *
 * It walks forward in the user's **local** calendar — day by day, then the hours and
 * minutes the expression allows — and converts the first match back to an instant. Going
 * the other way (stepping through instants) would need a conversion per minute and would
 * still get DST wrong.
 *
 * Null means the expression can never match (`30 2 31 2 *` — the 31st of February) or the
 * timezone is unknown.
 */
export function nextOccurrence(expression: string, timezone: string, after: Date = new Date()): Date | null {
  const parsed = parseCron(expression);
  if (!parsed.ok || !isValidTimezone(timezone)) return null;
  const { fields } = parsed;

  // Cron has a one-minute resolution, so the earliest candidate is the next whole minute.
  const earliest = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const start = wallTimeIn(new Date(earliest), timezone);

  // Four years covers the longest real gap — 29 February only falls on a given weekday
  // every so often — and bounds the loop for an expression that can never match.
  for (let offset = 0; offset <= 366 * 4; offset++) {
    const day = addDays(start, offset);
    if (!matchesDay(fields, day)) continue;

    for (const hour of fields.hours.values) {
      for (const minute of fields.minutes.values) {
        const instant = zonedTimeToInstant({ ...day, hour, minute }, timezone);
        if (instant.getTime() >= earliest) return instant;
      }
    }
  }

  return null;
}

/**
 * Day-of-month and day-of-week are **or**, not and, when both are restricted — which is
 * how cron has always behaved: `0 9 1 * MON` is the first of the month *and* every
 * Monday. With one of them `*`, only the other decides.
 */
function matchesDay(fields: CronFields, day: Wall) {
  if (!fields.months.values.includes(day.month)) return false;

  const dayOfWeek = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  const monthMatches = fields.daysOfMonth.values.includes(day.day);
  const weekMatches = fields.daysOfWeek.values.includes(dayOfWeek);

  if (fields.daysOfMonth.wildcard && fields.daysOfWeek.wildcard) return true;
  if (fields.daysOfMonth.wildcard) return weekMatches;
  if (fields.daysOfWeek.wildcard) return monthMatches;
  return monthMatches || weekMatches;
}

/** Calendar arithmetic on the wall-clock date, ignoring the clock itself. */
function addDays(day: Wall, offset: number): Wall {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day) + offset * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: day.hour,
    minute: day.minute,
  };
}

/** What the clock says in `timezone` at a given instant. */
export function wallTimeIn(instant: Date, timezone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // Intl writes midnight as "24" in some locales; the date is the one that matters.
  const hour = read("hour") % 24;
  return { year: read("year"), month: read("month"), day: read("day"), hour, minute: read("minute") };
}

/**
 * The instant at which the clock in `timezone` reads this wall time.
 *
 * Two passes: guess with the offset in force at the naive instant, then correct with the
 * offset in force at the guess. That is what gets a time near a DST change right — on the
 * day the clocks go back, 01:30 happens twice and this returns the first of them, which
 * is the one a person means.
 *
 * The hour the clocks skip forward has no instant at all, and the correction would land
 * *before* the jump (02:30 becoming 01:30, in the past and already run). Rounding the
 * answer back to the wall clock catches that, and the uncorrected guess is used instead:
 * one hour's worth of elapsed time later, so a 02:30 task still runs that day, at 03:30.
 */
export function zonedTimeToInstant(wall: Wall, timezone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstGuess = naive - offsetAt(new Date(naive), timezone);
  const corrected = naive - offsetAt(new Date(firstGuess), timezone);

  const reads = wallTimeIn(new Date(corrected), timezone);
  const exists =
    reads.year === wall.year &&
    reads.month === wall.month &&
    reads.day === wall.day &&
    reads.hour === wall.hour &&
    reads.minute === wall.minute;

  return new Date(exists ? corrected : firstGuess);
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(instant: Date, timezone: string) {
  const wall = wallTimeIn(instant, timezone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // The instant's own seconds are not in `wall`, so compare on whole minutes.
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

export function isValidTimezone(value: string) {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The schedule in plain words, for the Tasks list — "Every weekday at 09:00".
 *
 * It covers the shapes the task form can produce and falls back to the expression itself
 * for anything hand-written, rather than guessing and being wrong.
 */
export function describeSchedule(expression: string): string {
  const parsed = parseCron(expression);
  if (!parsed.ok) return expression;
  const { minutes, hours, daysOfMonth, months, daysOfWeek } = parsed.fields;

  const anyDate = daysOfMonth.wildcard && months.wildcard;
  const time = hours.values.length === 1 && minutes.values.length === 1 ? at(hours.values[0], minutes.values[0]) : null;

  // Listing all seven days is still every day — `1-7` and `0-7` both spell it that way.
  const everyDay = daysOfWeek.wildcard || daysOfWeek.values.length === 7;

  if (anyDate && time) {
    if (everyDay) return `Every day at ${time}`;
    if (sameAs(daysOfWeek.values, [1, 2, 3, 4, 5])) return `Every weekday at ${time}`;
    if (sameAs(daysOfWeek.values, [0, 6])) return `Every weekend day at ${time}`;
    if (daysOfWeek.values.length === 1) return `Every ${DAY_NAMES[daysOfWeek.values[0]]} at ${time}`;
    return `${daysOfWeek.values.map((day) => DAY_NAMES[day]).join(", ")} at ${time}`;
  }

  if (anyDate && everyDay && hours.wildcard) {
    if (minutes.values.length === 1) {
      return minutes.values[0] === 0 ? "Every hour, on the hour" : `Every hour at ${pad(minutes.values[0])} past`;
    }
    const gap = evenGap(minutes.values);
    if (gap) return `Every ${gap} minutes`;
  }

  if (anyDate && everyDay && minutes.values.length === 1) {
    const gap = evenGap(hours.values);
    const minute = minutes.values[0];
    if (gap) return minute === 0 ? `Every ${gap} hours` : `Every ${gap} hours at ${pad(minute)} past`;
  }

  if (months.wildcard && everyDay && daysOfMonth.values.length === 1 && time) {
    return `On the ${ordinal(daysOfMonth.values[0])} of each month at ${time}`;
  }

  return `Cron: ${expression}`;
}

/** The gap between values when they are evenly spaced across their whole range. */
function evenGap(values: number[]) {
  if (values.length < 2) return null;
  const gap = values[1] - values[0];
  const even = values.every((value, index) => index === 0 || value - values[index - 1] === gap);
  return even && values[0] < gap ? gap : null;
}

function sameAs(values: number[], expected: number[]) {
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

const at = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;
const pad = (value: number) => String(value).padStart(2, "0");

function ordinal(value: number) {
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}
