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

    section("VM tools are opt-in");
    const { resolveAgentTools, TOOLS } = await import("@/lib/tools");
    const offered = (await resolveAgentTools(agent)).map((r) => r.tool.key);
    check("a new agent gets no VM tools", !offered.some((key) => key.startsWith("sandbox.")), offered);
    check("all six are registered", ["run_code", "write_file", "read_file", "list_files", "share_file", "open_browser"].every((k) => `sandbox.${k}` in TOOLS));

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

      section("Agent tools in the VM (live)");
      const sandboxTools = await import("@/lib/tools/sandbox");
      const { runs } = await import("@/db");
      // A real run row: shared files are recorded against the run that shared them.
      const [testRun] = await db.insert(runs).values({ agentId: agent.id, userId: user.id, trigger: "chat" }).returning();
      const ctx = {
        user,
        agent,
        runId: testRun.id,
        timezone: "UTC",
        signal: new AbortController().signal,
        auth: null,
      };
      type Out = { exitCode: number; stdout: string; stderr: string };
      const run = async (language: string, code: string) =>
        sandboxTools.sandboxRunCode.execute(ctx, { language, code });

      const t1 = Date.now();
      const py = await run("python", "print(sum(range(10)))");
      console.log(`       first call (starts the VM) took ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      check("python runs, starting the VM by itself", "output" in py && (py.output as Out).stdout.trim() === "45", py);
      check("the VM is now running", (await vmLib.getSandbox(user.id, agent.id)).status === "running");

      // The run is also shown in a terminal window on the VM's screen, following a log.
      const onScreen = await Sandbox.connect((await providerIdOf())!);
      const viewer = await onScreen.commands.run("pgrep -f '\\.show\\.sh' || true");
      check("a terminal window shows the run on the VM's screen", viewer.stdout.trim().length > 0, viewer.stdout);
      const logs = await onScreen.commands.run("cat /home/user/.omnix/run-*.log; cat /home/user/.omnix/run-*.exit");
      check("the window's log has the output and exit code", /45/.test(logs.stdout) && /\b0\b/.test(logs.stdout), logs.stdout);
      const shotAt = process.argv.indexOf("--shot");
      if (shotAt !== -1 && process.argv[shotAt + 1]) {
        await onScreen.wait(1500);
        (await import("node:fs")).writeFileSync(process.argv[shotAt + 1], await onScreen.screenshot());
        console.log(`       screenshot of the VM's screen: ${process.argv[shotAt + 1]}`);
      }
      const bad = await run("python", "raise ValueError('boom')");
      check(
        "a failing program is output, with its error",
        "output" in bad && (bad.output as Out).exitCode !== 0 && (bad.output as Out).stderr.includes("ValueError"),
        bad,
      );
      const sh = await run("bash", "echo hi from $(uname -s)");
      check("bash runs", "output" in sh && (sh.output as Out).stdout.includes("hi from Linux"), sh);
      // Node isn't in E2B's desktop image, so it isn't offered: a clear refusal, no VM call.
      const js = await run("node", "console.log(6 * 7)");
      check("node is refused clearly", "error" in js && js.error.includes("python or bash"), js);

      const saved = await sandboxTools.sandboxWriteFile.execute(ctx, { path: "notes/today.md", content: "# Hello" });
      check("write_file saves under /home/user", "output" in saved, saved);
      const read = await sandboxTools.sandboxReadFile.execute(ctx, { path: "/home/user/notes/today.md" });
      check("read_file reads it back", "output" in read && (read.output as { text: string }).text === "# Hello", read);
      const listed = await sandboxTools.sandboxListFiles.execute(ctx, { path: "notes" });
      check(
        "list_files finds it",
        "output" in listed && (listed.output as { entries: { name: string }[] }).entries.some((e) => e.name === "today.md"),
        listed,
      );
      const home = await sandboxTools.sandboxListFiles.execute(ctx, {});
      check(
        "our scratch folder is hidden",
        "output" in home && !(home.output as { entries: { name: string }[] }).entries.some((e) => e.name === ".omnix"),
      );
      section("Sharing files out of the VM (live)");
      const csv = "title,company\nFull stack developer,Acme\n";
      await sandboxTools.sandboxWriteFile.execute(ctx, { path: "out/jobs.csv", content: csv });
      const shared = await sandboxTools.sandboxShareFile.execute(ctx, { path: "out/jobs.csv", name: "new_jobs.csv" });
      check("share_file returns a download link", "output" in shared && /^\[new_jobs\.csv\]\(\/api\/files\/[0-9a-f-]{36}\)$/.test((shared.output as { markdown: string }).markdown), shared);
      const fileId = "output" in shared ? (shared.output as { link: string }).link.split("/").pop()! : "";
      const files = await import("@/lib/files");
      const stored = await files.getOwnedFile(user.id, fileId);
      check("the file is stored byte for byte", stored?.data.toString("utf8") === csv);
      check("as a CSV, named as asked", stored?.mimeType === "text/csv" && stored?.name === "new_jobs.csv", stored && { mime: stored.mimeType, name: stored.name });
      check("nobody else can get it", (await files.getOwnedFile(user.id + 1_000_000, fileId)) === null);
      try {
        const anon = await fetch(`http://localhost:3000/api/files/${fileId}`);
        check("the download link needs sign-in (404 without)", anon.status === 404, anon.status);
      } catch {
        console.log("       (dev server not running: skipped the HTTP check)");
      }
      await sandboxTools.sandboxRunCode.execute(ctx, { language: "bash", code: "head -c 6000000 /dev/zero > /home/user/big.bin" });
      const big = await sandboxTools.sandboxShareFile.execute(ctx, { path: "big.bin" });
      check("files over 5 MB are refused", "error" in big && big.error.includes("limit"), big);
      const dir = await sandboxTools.sandboxShareFile.execute(ctx, { path: "out" });
      check("folders are refused", "error" in dir, dir);

      const escape1 = await sandboxTools.sandboxReadFile.execute(ctx, { path: "/etc/passwd" });
      check("paths outside home are refused", "error" in escape1, escape1);
      const escape2 = await sandboxTools.sandboxReadFile.execute(ctx, { path: "../../etc/passwd" });
      check("so are ../ escapes", "error" in escape2, escape2);
      const browser = await sandboxTools.sandboxOpenBrowser.execute(ctx, { url: "https://example.com" });
      check("open_browser opens a page", "output" in browser, browser);
      console.log(`       window title: ${"output" in browser ? JSON.stringify((browser.output as { windowTitle: string }).windowTitle) : "-"}`);
      const notWeb = await sandboxTools.sandboxOpenBrowser.execute(ctx, { url: "file:///etc/passwd" });
      check("open_browser refuses non-web addresses", "error" in notWeb, notWeb);
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
