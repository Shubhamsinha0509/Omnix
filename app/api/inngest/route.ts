import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { inngestConfigProblems } from "@/lib/inngest/config";
import { functions } from "@/lib/inngest/functions";

/**
 * Inngest's endpoint: it calls back here to run each step of a function.
 *
 * In development, `npm run inngest:dev` discovers this URL and drives the crons, and
 * nothing is signed. In production every request must be signed with INNGEST_SIGNING_KEY,
 * which the SDK checks, so only Inngest can run these functions (D57). The fallback key
 * lets the signing key be rotated without downtime: set the new one as INNGEST_SIGNING_KEY
 * and the old one as INNGEST_SIGNING_KEY_FALLBACK until Inngest has switched over.
 */
/**
 * Each Inngest step is its own request here, and the longest is one VM tool call
 * (starting the VM plus 90 s of code, about 2.5 minutes). Room for that (D58).
 */
export const maxDuration = 300;

const handlers = serve({
  client: inngest,
  functions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
  signingKeyFallback: process.env.INNGEST_SIGNING_KEY_FALLBACK || undefined,
});

/**
 * In production, a missing or placeholder key would make every scheduled task fail with
 * an unhelpful signature error. Say what to fix in the server log; the public response
 * says only that background jobs aren't set up, not which settings are missing.
 */
const problems = inngestConfigProblems();
if (problems.length > 0) {
  console.error(`Inngest is not configured for production, so background tasks won't run:\n- ${problems.join("\n- ")}`);
}

function guarded<H extends (...args: never[]) => unknown>(handler: H) {
  return ((...args: Parameters<H>) =>
    problems.length > 0
      ? Response.json({ error: "Background jobs aren't configured on this server." }, { status: 503 })
      : handler(...args)) as H;
}

export const GET = guarded(handlers.GET);
export const POST = guarded(handlers.POST);
export const PUT = guarded(handlers.PUT);
