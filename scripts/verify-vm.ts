/**
 * Phase 6 verification: an agent's VM (lib/sandbox), checked against the real database
 * and, with `--live`, a real E2B sandbox.
 *
 *   npm run verify:vm
 *   npm run verify:vm -- --live
 *
 * It works on a throwaway agent it creates for the first user and deletes at the end, so
 * no real agent is touched. `--live` needs E2B_API_KEY in .env and starts one real VM for
 * about a minute: start (two clicks at once must make one VM), write a file, pause,
 * resume (the file must still be there), stop. It is killed at the end whatever happens.
 *
 * Node has no tsconfig-paths support, so the "@/" alias is resolved by a loader hook
 * registered below before any app module is imported; every import of one is dynamic.
 */
import { createRequire, register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.join(import.meta.dirname, "ts-alias-hook.mjs")));

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(path.resolve(import.meta.dirname, ".."), true, { info() {}, error() {} });

const live = process.argv.includes("--live");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

function section(title: string) {
  console.log(`\n== ${title}`);
}

async function main() {
  const vmLib = await import("@/lib/sandbox");
  const { db, users, agents, sandboxes } = await import("@/db");
  const { asc, eq } = await import("drizzle-orm");
  const { Sandbox } = await import("@e2b/desktop");

  const [user] = await db.select().from(users).orderBy(asc(users.id)).limit(1);
  if (!user) throw new Error("No user in the database. Sign in to the app once first.");

  const [agent] = await db
    .insert(agents)
    .values({ userId: user.id, name: "VM check (temporary)" })
    .returning();
  const providerIdOf = async () =>
    (await db.select().from(sandboxes).where(eq(sandboxes.agentId, agent.id)))[0]?.providerId ?? null;

  try {
    section("Without a VM");
    const off = await vmLib.getSandbox(user.id, agent.id);
    check("a new agent's VM reads as stopped", off.status === "stopped", off);
    check("and has used no time", off.usedSeconds === 0, off);
    check("someone else can't see it", (await vmLib.getSandbox(user.id + 1_000_000, agent.id)).status === "stopped");
    check("pause with no VM is a no-op", "vm" in (await vmLib.pauseSandbox(user.id, agent.id)) || !vmLib.hasSandboxKey());
    check("stop with no VM is a no-op", "vm" in (await vmLib.stopSandbox(user.id, agent.id)) || !vmLib.hasSandboxKey());

    if (!vmLib.hasSandboxKey()) {
      section("No E2B key");
      const result = await vmLib.startSandbox(user.id, agent.id);
      check("start explains the missing key", "error" in result && result.error.includes("E2B_API_KEY"), result);
    }

    if (live) {
      if (!vmLib.hasSandboxKey()) throw new Error("--live needs E2B_API_KEY in .env");

      section("Start (live)");
      const t0 = Date.now();
      const [a, b] = await Promise.all([
        vmLib.startSandbox(user.id, agent.id),
        vmLib.startSandbox(user.id, agent.id),
      ]);
      console.log(`       started in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      const after = await vmLib.getSandbox(user.id, agent.id);
      check("it is running", after.status === "running", { a, b, after });
      check("one of two clicks did the work", ["error" in a, "error" in b].filter(Boolean).length === 0, { a, b });
      const providerId = await providerIdOf();
      check("E2B has an id for it", Boolean(providerId));
      const found = await Sandbox.list({ query: { metadata: { agentId: agent.id } } }).nextItems();
      check("exactly one VM exists for the agent", found.length === 1, found.map((s) => s.sandboxId));
      check("E2B says running", (await Sandbox.getInfo(providerId!)).state === "running");
      check("it will pause itself when idle", after.expiresAt !== null);

      section("Live screen (live)");
      const s1 = await vmLib.openSandboxScreen(user.id, agent.id);
      check("the screen opens", "screen" in s1, s1);
      if ("screen" in s1) {
        const { viewUrl, controlUrl } = s1.screen;
        check("links are https", viewUrl.startsWith("https://") && controlUrl.startsWith("https://"));
        check("the watch link is view-only", /view_only=true/.test(viewUrl), viewUrl.replace(/password=[^&]+/, "password=…"));
        check("the control link is not", !/view_only=true/.test(controlUrl));
        check("both are password-protected", /password=/.test(viewUrl) && /password=/.test(controlUrl));
        const page = await fetch(viewUrl);
        check("the viewer page loads", page.ok, page.status);
        const s2 = await vmLib.openSandboxScreen(user.id, agent.id);
        const pw = (url: string) => new URL(url).searchParams.get("password");
        check("reopening issues a new password", "screen" in s2 && pw(s2.screen.viewUrl) !== pw(viewUrl));
      }

      section("Pause and resume keep files (live)");
      const vm = await Sandbox.connect(providerId!);
      await vm.files.write("/home/user/omnix-check.txt", "kept across pause");
      const paused = await vmLib.pauseSandbox(user.id, agent.id);
      check("pause works", "vm" in paused && paused.vm.status === "paused", paused);
      check("E2B says paused", (await Sandbox.getInfo(providerId!)).state === "paused");
      check("running time was counted", "vm" in paused && paused.vm.usedSeconds > 0, paused);

      const resumed = await vmLib.startSandbox(user.id, agent.id);
      check("resume works", "vm" in resumed && resumed.vm.status === "running", resumed);
      check("it is the same VM", (await providerIdOf()) === providerId);
      const again = await Sandbox.connect(providerId!);
      check("the file survived", (await again.files.read("/home/user/omnix-check.txt")) === "kept across pause");

      section("Stop (live)");
      const stopped = await vmLib.stopSandbox(user.id, agent.id);
      check("stop works", "vm" in stopped && stopped.vm.status === "stopped", stopped);
      check("the record forgets the VM", (await providerIdOf()) === null);
      let gone = false;
      try {
        const info = await Sandbox.getInfo(providerId!);
        gone = !info;
      } catch {
        gone = true;
      }
      check("E2B no longer has it", gone);
    } else {
      console.log("\n(skipping live checks; pass --live to start a real VM)");
    }
  } finally {
    // Whatever happened above: kill any VM, then remove the throwaway agent (and its row).
    await vmLib.destroySandbox(user.id, agent.id);
    await db.delete(agents).where(eq(agents.id, agent.id));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`failed: ${failures.join("; ")}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
