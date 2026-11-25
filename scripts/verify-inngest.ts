/**
 * The Inngest endpoint's protection (D57), with the real SDK, in-process, no network.
 *
 *   npm run verify:inngest
 *
 * 1. Which settings count as configured, in dev and in production.
 * 2. Our /api/inngest route refuses to run, with a clear log line, when production keys
 *    are missing or still placeholders.
 * 3. In production mode the SDK refuses unsigned and wrongly signed requests and accepts a
 *    correctly signed one — using a made-up key of the right shape, never a real one.
 */
import { createRequire, register } from "node:module";
import { createHmac } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.join(import.meta.dirname, "ts-alias-hook.mjs")));
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(path.resolve(import.meta.dirname, ".."), true, { info() {}, error() {} });

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) passed++;
  else failed++;
  console.log(`  ${condition ? "ok  " : "FAIL"} ${name}${condition || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const TEST_KEY = `signkey-test-${"ab12".repeat(16)}`;
const URL_ = "http://localhost:3000/api/inngest";

async function main() {
  const { inngestConfigProblems, inngestMode } = await import("@/lib/inngest/config");

  console.log("\n== Which settings count");
  check("local (no NODE_ENV production) is dev mode", inngestMode({ NODE_ENV: "development" }) === "dev");
  check("NODE_ENV=production is production mode", inngestMode({ NODE_ENV: "production" }) === "cloud");
  check("a Vercel preview is production mode", inngestMode({ VERCEL_ENV: "preview" }) === "cloud");
  check("INNGEST_DEV=1 forces dev", inngestMode({ NODE_ENV: "production", INNGEST_DEV: "1" }) === "dev");
  check("dev needs no keys", inngestConfigProblems({ NODE_ENV: "development" }).length === 0);
  const placeholders = inngestConfigProblems({
    NODE_ENV: "production",
    INNGEST_SIGNING_KEY: "your_inngest_signing_key_here",
    INNGEST_EVENT_KEY: "your_inngest_event_key_here",
  });
  check("production with the old placeholders: both keys flagged", placeholders.length === 2, placeholders);
  check("a key of the wrong shape is flagged", inngestConfigProblems({ NODE_ENV: "production", INNGEST_SIGNING_KEY: "abc123", INNGEST_EVENT_KEY: "k" }).length === 1);
  check("real-shaped keys pass", inngestConfigProblems({ NODE_ENV: "production", INNGEST_SIGNING_KEY: TEST_KEY, INNGEST_EVENT_KEY: "evt_key_123" }).length === 0);

  console.log("\n== Our route, in production with placeholder keys");
  const saved = { ...process.env };
  Object.assign(process.env, { INNGEST_DEV: "0", INNGEST_SIGNING_KEY: "your_inngest_signing_key_here", INNGEST_EVENT_KEY: "your_inngest_event_key_here" });
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  const route = await import("@/app/api/inngest/route");
  console.error = realError;
  const refused = (await route.POST(new Request(URL_, { method: "POST", body: "{}" }) as never, undefined as never)) as Response;
  check("it refuses with 503", refused.status === 503, refused.status);
  const body = (await refused.json()) as { error?: string; problems?: unknown };
  check("…without naming which settings are missing", body.problems === undefined && /aren't configured/.test(body.error ?? ""), body);
  check("the server log says which keys to set", logged.some((line) => line.includes("INNGEST_SIGNING_KEY") && line.includes("INNGEST_EVENT_KEY")), logged);
  process.env = saved;

  console.log("\n== The SDK's signature check, in production mode");
  const { Inngest } = await import("inngest");
  const { serve } = await import("inngest/next");
  const canonicalize = require("canonicalize") as (value: unknown) => string;
  const client = new Inngest({ id: "verify-signing", isDev: false, eventKey: "test" });
  const fn = client.createFunction({ id: "noop" }, { event: "verify/noop" }, async () => "ok");
  const handlers = serve({ client, functions: [fn], signingKey: TEST_KEY });

  const call = async (method: "GET" | "POST", signature?: string, body?: string) =>
    (handlers[method] as (req: Request) => Promise<Response>)(
      new Request(`${URL_}?fnId=verify-signing-noop&stepId=step`, {
        method,
        headers: { "Content-Type": "application/json", ...(signature ? { "X-Inngest-Signature": signature } : {}) },
        body,
      }),
    );
  const sign = (payload: unknown) => {
    const ts = Math.round(Date.now() / 1000).toString();
    const key = TEST_KEY.replace(/^signkey-\w+-/, "");
    return `t=${ts}&s=${createHmac("sha256", key).update(canonicalize(payload) + ts).digest("hex")}`;
  };
  const payload = { ctx: { fn_id: "verify-signing-noop", run_id: "r1", attempt: 0, stack: { stack: [], current: 0 } }, event: { name: "verify/noop", data: {} }, events: [{ name: "verify/noop", data: {} }], steps: {}, version: 1, use_api: false };
  const json = JSON.stringify(payload);

  check("unsigned introspection (GET) is refused", (await call("GET")).status === 401);
  check("an unsigned call to run a function is refused", (await call("POST", undefined, json)).status === 401);
  check("a wrongly signed call is refused", (await call("POST", `t=${Math.round(Date.now() / 1000)}&s=${"0".repeat(64)}`, json)).status === 401);
  const old = Math.round(Date.now() / 1000) - 600;
  const key = TEST_KEY.replace(/^signkey-\w+-/, "");
  const stale = `t=${old}&s=${createHmac("sha256", key).update(canonicalize(payload) + old).digest("hex")}`;
  check("a correctly signed but 10-minute-old call is refused (no replays)", (await call("POST", stale, json)).status === 401);
  const accepted = await call("POST", sign(payload), json);
  check("a correctly signed call gets through the check", accepted.status !== 401, accepted.status);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
