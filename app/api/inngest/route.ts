import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

/**
 * Inngest's endpoint: it calls back here to run each step of a function.
 *
 * In development, `npm run inngest:dev` discovers this URL and drives the crons. In
 * production the Vercel integration does, and it needs `INNGEST_SIGNING_KEY` set — a
 * missing key is what makes a schedule look like it is "just not firing".
 */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
