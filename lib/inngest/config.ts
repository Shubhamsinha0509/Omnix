/**
 * Whether Inngest is set up safely for where the app is running (D57).
 *
 * In production the Inngest SDK only runs requests to /api/inngest that carry a valid
 * signature made with INNGEST_SIGNING_KEY, so nobody else can trigger the app's background
 * functions; and `inngest.send` needs INNGEST_EVENT_KEY. A missing or placeholder key
 * doesn't open anything up (the SDK refuses unsigned requests), but every scheduled task
 * then silently never runs. This says so plainly instead.
 *
 * Locally the Inngest dev server neither signs nor needs keys.
 */

export type InngestEnv = Record<string, string | undefined>;

/**
 * "dev" or "cloud", the way the SDK decides it (inngest/helpers/env.js `getMode`): an
 * explicit INNGEST_DEV wins; otherwise production-looking environments are "cloud".
 * Only the checks for where Omnix runs (Node, Vercel) are mirrored.
 */
export function inngestMode(env: InngestEnv = process.env): "dev" | "cloud" {
  const explicit = env.INNGEST_DEV?.trim().toLowerCase();
  if (explicit !== undefined && explicit !== "") {
    if (["1", "true"].includes(explicit) || /^https?:\/\//.test(explicit)) return "dev";
    if (["0", "false"].includes(explicit)) return "cloud";
  }
  const vercel = env.VERCEL_ENV?.trim();
  if (env.NODE_ENV?.startsWith("prod") || (vercel && vercel !== "development")) return "cloud";
  return "dev";
}

/** Signing keys look like `signkey-prod-<hex>` (or `signkey-branch-…`, `signkey-test-…`). */
const SIGNING_KEY = /^signkey-[a-z]+-[0-9a-f]{16,}$/i;
/** The placeholders `.env.example` used to ship with, and anything like them. */
const placeholder = (value: string) => /^your[_-]|placeholder|changeme|^x+$/i.test(value);

/** What's wrong with the Inngest setup for this environment; empty when it's fine. */
export function inngestConfigProblems(env: InngestEnv = process.env): string[] {
  if (inngestMode(env) === "dev") return [];
  const problems: string[] = [];

  const signing = env.INNGEST_SIGNING_KEY?.trim() ?? "";
  if (!signing || placeholder(signing)) {
    problems.push("INNGEST_SIGNING_KEY is not set. Copy it from the Inngest dashboard (Manage → Signing Key).");
  } else if (!SIGNING_KEY.test(signing)) {
    problems.push("INNGEST_SIGNING_KEY doesn't look like an Inngest signing key (signkey-prod-…).");
  }

  const fallback = env.INNGEST_SIGNING_KEY_FALLBACK?.trim();
  if (fallback && !SIGNING_KEY.test(fallback)) {
    problems.push("INNGEST_SIGNING_KEY_FALLBACK is set but doesn't look like a signing key.");
  }

  const event = env.INNGEST_EVENT_KEY?.trim() ?? "";
  if (!event || placeholder(event)) {
    problems.push("INNGEST_EVENT_KEY is not set. Create one in the Inngest dashboard (Manage → Event Keys).");
  }
  return problems;
}
