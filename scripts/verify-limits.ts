/**
 * Rate limits (lib/rate-limit.ts) and the monthly VM time cap (lib/vm-usage.ts).
 *
 *   npm run verify:limits             no VM is started
 *   npm run verify:limits -- --live   also starts one real VM for about a minute
 *
 * Works on a throwaway agent and its own usage rows, and removes them at the end.
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
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) passed++;
  else failed++;
  console.log(`  ${condition ? "ok  " : "FAIL"} ${name}${condition || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function main() {
  const { rateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
  const usage = await import("@/lib/vm-usage");
  const vmLib = await import("@/lib/sandbox");
  const { db, users, agents, rateLimits, vmUsage } = await import("@/db");
  const { asc, eq, like, and, gte } = await import("drizzle-orm");

  const [user] = await db.select().from(users).orderBy(asc(users.id)).limit(1);
  const [agent] = await db.insert(agents).values({ userId: user.id, name: "Limits check (temporary)" }).returning();
  const fakeUser = 900_000_000 + Math.floor(Math.random() * 1000);
  const insertedUsage: string[] = [];
  const addUsage = async (seconds: number) => {
    const now = new Date();
    const [row] = await db
      .insert(vmUsage)
      .values({ userId: user.id, agentId: agent.id, startedAt: new Date(now.getTime() - seconds * 1000), endedAt: now, seconds })
      .returning();
    insertedUsage.push(row.id);
  };

  try {
    console.log("\n== Rate limits");
    const { limit } = RATE_LIMITS.chatPerMinute;
    const results = [];
    for (let i = 0; i <= limit; i++) results.push(await rateLimit(fakeUser, "chatPerMinute"));
    check(`the first ${limit} messages in a minute go through`, results.slice(0, limit).every((r) => r.ok));
    const last = results[limit];
    check("the next one is refused", !last.ok, last);
    check("with a plain reason and a wait", !last.ok && /more than 10 messages a minute/.test(last.error) && last.retryAfterSeconds > 0, last);
    check("other limits are counted separately", (await rateLimit(fakeUser, "vmActionPerMinute")).ok);
    const parallel = await Promise.all(Array.from({ length: 8 }, () => rateLimit(fakeUser + 1, "runNowPerMinute")));
    check("parallel requests count exactly (5 of 8 allowed)", parallel.filter((r) => r.ok).length === RATE_LIMITS.runNowPerMinute.limit, parallel.filter((r) => r.ok).length);

    console.log("\n== VM time cap");
    const before = await usage.vmBudget(user.id);
    console.log(`       this month so far: ${Math.round(before.usedSeconds / 60)} of ${before.allowanceSeconds / 60} min`);
    const room = before.leftSeconds;
    await addUsage(room);
    const full = await usage.vmBudget(user.id);
    check("usage adds up to the allowance", full.leftSeconds === 0, full);
    const refused = await vmLib.startSandbox(user.id, agent.id);
    check("Start is refused at the cap, before E2B is called", "error" in refused && refused.error.includes("minutes of VM time this month"), refused);
    const viaTool = await vmLib.sandboxForTool(user.id, agent.id);
    check("so is an agent's VM tool call", "error" in viaTool && viaTool.error.includes("VM time"), "error" in viaTool ? viaTool.error : "started");

    if (live) {
      console.log("\n== Stops at the cap (live)");
      // Leave 30 seconds of the allowance.
      await db.delete(vmUsage).where(eq(vmUsage.id, insertedUsage.pop()!));
      await addUsage(Math.max(0, room - 30));
      const started = await vmLib.startSandbox(user.id, agent.id);
      check("starts with 30 seconds left", "vm" in started && started.vm.status === "running", started);
      const until = "vm" in started && started.vm.expiresAt ? new Date(started.vm.expiresAt).getTime() - Date.now() : -1;
      check("…and is set to stop at the cap, not after 10 idle minutes", until > 0 && until <= 35_000, Math.round(until / 1000));
      console.log("       waiting 50 s for E2B to stop it…");
      await new Promise((r) => setTimeout(r, 50_000));
      const after = await vmLib.getSandbox(user.id, agent.id);
      check("E2B stopped it at the cap (files kept)", after.status === "paused", after.status);
      const recorded = await db
        .select()
        .from(vmUsage)
        .where(and(eq(vmUsage.agentId, agent.id), gte(vmUsage.seconds, 20)));
      check("that stretch was recorded for the month", recorded.some((r) => r.seconds <= 40 && !insertedUsage.includes(r.id)), recorded.map((r) => r.seconds));
      check("and nothing more can start", "error" in (await vmLib.startSandbox(user.id, agent.id)));
    } else {
      console.log("\n(skipping the live check; pass --live to start a real VM for about a minute)");
    }
  } finally {
    await vmLib.destroySandbox(user.id, agent.id);
    await db.delete(vmUsage).where(eq(vmUsage.agentId, agent.id));
    await db.delete(agents).where(eq(agents.id, agent.id));
    await db.delete(rateLimits).where(like(rateLimits.key, `%:${fakeUser}:%`));
    await db.delete(rateLimits).where(like(rateLimits.key, `%:${fakeUser + 1}:%`));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
