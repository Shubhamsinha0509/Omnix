import { lt, sql } from "drizzle-orm";

import { db, rateLimits } from "@/db";

/**
 * Per-user request limits, against runaway cost and abuse (docs/07-security.md#abuse-and-cost).
 *
 * Fixed windows counted in Postgres: each request bumps its window's row in one upsert and
 * reads the new count back, so the limit holds however many server instances there are
 * (an in-memory counter would reset with every serverless instance). Background runs have
 * their own caps (D45); these cover what a person, or a leaked session, can fire directly.
 */

export const RATE_LIMITS = {
  /** Each message starts a model turn, which costs money. */
  chatPerMinute: { limit: 10, windowMs: 60_000, what: "messages a minute" },
  chatPerDay: { limit: 300, windowMs: 24 * 60 * 60_000, what: "messages a day" },
  /** Approving or rejecting resumes a turn: model calls again. */
  decisionPerMinute: { limit: 20, windowMs: 60_000, what: "approval decisions a minute" },
  /** Start, stop, delete and open-screen each call E2B. */
  vmActionPerMinute: { limit: 20, windowMs: 60_000, what: "VM actions a minute" },
  /** "Run now" on a task; each one is a full background run. */
  runNowPerMinute: { limit: 5, windowMs: 60_000, what: "manual task runs a minute" },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = { ok: true } | { ok: false; error: string; retryAfterSeconds: number };

/** Counts one request against `name` for this user; refuses it once the window is full. */
export async function rateLimit(userId: number, name: RateLimitName): Promise<RateLimitResult> {
  const { limit, windowMs, what } = RATE_LIMITS[name];
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${name}:${userId}:${windowStart}`;
  const expiresAt = new Date(windowStart + windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt })
    .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });

  if (row.count <= limit) return { ok: true };
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
  const wait = retryAfterSeconds < 120 ? `${retryAfterSeconds} seconds` : `${Math.ceil(retryAfterSeconds / 60)} minutes`;
  return { ok: false, retryAfterSeconds, error: `That's more than ${limit} ${what}. Try again in ${wait}.` };
}

/** Deletes finished windows, for the nightly sweep. */
export async function purgeExpiredRateLimits() {
  const deleted = await db.delete(rateLimits).where(lt(rateLimits.expiresAt, new Date())).returning({ key: rateLimits.key });
  return deleted.length;
}
