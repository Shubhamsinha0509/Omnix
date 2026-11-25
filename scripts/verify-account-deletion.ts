/**
 * Account deletion (lib/account.ts, D56): a throwaway user with something in every table,
 * deleted, then every table checked. Other users' data is counted before and after.
 *
 *   npm run verify:account-deletion
 *
 * No VM is started and no provider is called: the throwaway connection is of a provider
 * with nothing to revoke, and its VM record has no E2B id.
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
  const schema = await import("@/db");
  const { db } = schema;
  const { eq, like, ne, sql } = await import("drizzle-orm");
  const { deleteAccountData } = await import("@/lib/account");
  const { saveConnection } = await import("@/lib/integrations/connections");

  // Everything another user has, to prove it isn't touched.
  const TABLES = {
    agents: schema.agents,
    conversations: schema.conversations,
    tasks: schema.tasks,
    runs: schema.runs,
    approvals: schema.approvals,
    notifications: schema.notifications,
    connections: schema.connections,
    sandboxes: schema.sandboxes,
    vm_usage: schema.vmUsage,
    shared_files: schema.sharedFiles,
  } as const;
  const othersCount = async (userId: number) => {
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries(TABLES)) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(ne(table.userId, userId));
      out[name] = row.n;
    }
    return out;
  };

  const [user] = await db
    .insert(schema.users)
    .values({ email: `deletion-check-${Date.now()}@example.invalid`, name: "Deletion check" })
    .returning();
  const before = await othersCount(user.id);

  // One of everything.
  const [agent] = await db.insert(schema.agents).values({ userId: user.id, name: "To be deleted" }).returning();
  const [conversation] = await db
    .insert(schema.conversations)
    .values({ agentId: agent.id, userId: user.id, title: "hello" })
    .returning();
  await db.insert(schema.messages).values({ conversationId: conversation.id, role: "user", content: "secret message" });
  const [task] = await db
    .insert(schema.tasks)
    .values({ agentId: agent.id, userId: user.id, name: "t", prompt: "p", trigger: "manual", timezone: "UTC", deliver: ["inapp"] })
    .returning();
  const [run] = await db
    .insert(schema.runs)
    .values({ agentId: agent.id, userId: user.id, trigger: "chat", conversationId: conversation.id, status: "succeeded" })
    .returning();
  await db.insert(schema.runSteps).values({ runId: run.id, seq: 0, type: "model", payload: { text: "secret" } });
  await db.insert(schema.approvals).values({
    runId: run.id, userId: user.id, tool: "gmail.send", toolCallId: "c1", summary: "s",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db.insert(schema.notifications).values({ userId: user.id, kind: "task_result", title: "t", body: "b", agentId: agent.id, taskId: task.id });
  await db.insert(schema.agentTools).values({ agentId: agent.id, tool: "web.fetch", enabled: true, approval: "never" });
  await saveConnection({ userId: user.id, provider: "deletion-check", accountLabel: "x", accessToken: "not-a-real-token" });
  await db.insert(schema.sandboxes).values({ agentId: agent.id, userId: user.id });
  await db.insert(schema.vmUsage).values({ userId: user.id, agentId: agent.id, startedAt: new Date(), endedAt: new Date(), seconds: 60 });
  await db.insert(schema.sharedFiles).values({
    userId: user.id, agentId: agent.id, runId: run.id, name: "a.csv", sourcePath: "/home/user/a.csv",
    mimeType: "text/csv", size: 3, data: Buffer.from("a,b"),
  });
  await db.insert(schema.rateLimits).values({ key: `chatPerMinute:${user.id}:0`, count: 1, expiresAt: new Date(Date.now() + 60_000) });

  console.log("\n== Delete");
  const result = await deleteAccountData(user.id);
  check("the account is deleted", result.deleted, result);
  check("its connection was processed for revoking", result.connections === 1 && result.revokeFailures === 0, result);

  console.log("\n== Nothing of it is left");
  check("user row", (await db.select().from(schema.users).where(eq(schema.users.id, user.id))).length === 0);
  for (const [name, table] of Object.entries(TABLES)) {
    const left = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, user.id));
    check(name, left[0].n === 0, left[0].n);
  }
  check("messages", (await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversation.id))).length === 0);
  check("run steps", (await db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, run.id))).length === 0);
  check("tool settings", (await db.select().from(schema.agentTools).where(eq(schema.agentTools.agentId, agent.id))).length === 0);
  check("rate-limit counters", (await db.select().from(schema.rateLimits).where(like(schema.rateLimits.key, `%:${user.id}:%`))).length === 0);

  console.log("\n== Everyone else is untouched");
  const after = await othersCount(user.id);
  check("other users' rows in every table are the same", JSON.stringify(before) === JSON.stringify(after), { before, after });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
