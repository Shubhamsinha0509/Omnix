/**
 * A chat turn's deadline (D58): with the real runner, against a fake model on localhost
 * that keeps asking for a tool. No real model is called and no money is spent.
 *
 *   npm run verify:deadline
 *
 * Uses a throwaway agent, deleted at the end.
 */
import http from "node:http";
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

/** A stand-in for OpenRouter: asks for `time.now` until it has a tool result, then answers. */
function fakeModel() {
  let requests = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests++;
      const request = JSON.parse(body || "{}") as { messages?: { role: string }[] };
      const answered = request.messages?.at(-1)?.role === "tool";
      const chunk = (delta: object, finish: string | null, usage?: object) =>
        `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (answered) {
        res.write(chunk({ role: "assistant", content: "It is now." }, null));
        res.write(chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
      } else {
        res.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${requests}`, type: "function", function: { name: "time_now", arguments: "{}" } }] }, null));
        res.write(chunk({}, "tool_calls", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
      }
      res.end("data: [DONE]\n\n");
    });
  });
  return { server, count: () => requests, reset: () => (requests = 0) };
}

async function main() {
  const model = fakeModel();
  await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", resolve));
  const port = (model.server.address() as { port: number }).port;
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENROUTER_API_KEY = "fake-key-for-local-test";

  const { runAgent, LIMITS } = await import("@/lib/agent/runner");
  const { db, users, agents, runSteps } = await import("@/db");
  const { asc, eq } = await import("drizzle-orm");

  const [user] = await db.select().from(users).orderBy(asc(users.id)).limit(1);
  const [agent] = await db.insert(agents).values({ userId: user.id, name: "Deadline check (temporary)" }).returning();

  const turn = async (deadlineAt?: number) => {
    model.reset();
    const notes: string[] = [];
    const tools: string[] = [];
    const outcome = await runAgent({
      agent,
      user,
      trigger: "chat",
      history: [{ role: "user", content: "What time is it?" }],
      timezone: "UTC",
      signal: new AbortController().signal,
      emit: (event) => {
        if (event.t === "note") notes.push(event.v);
        if (event.t === "activity" && event.status === "done") tools.push(event.tool);
      },
      deadlineAt,
    });
    const reasons = (await db.select().from(runSteps).where(eq(runSteps.runId, outcome.runId)))
      .filter((s) => s.type === "error")
      .map((s) => (s.payload as { reason?: string }).reason);
    return { outcome, notes, tools, modelCalls: model.count(), reasons };
  };

  try {
    console.log("\n== No deadline (a background run)");
    const free = await turn();
    check("finishes normally: tool, then answer", free.outcome.status === "succeeded" && free.outcome.reply === "It is now." && free.tools.includes("time.now"), free);

    console.log("\n== Plenty of time");
    const roomy = await turn(Date.now() + 5 * 60_000);
    check("same result well inside the deadline", roomy.outcome.reply === "It is now." && roomy.notes.length === 0, roomy);

    console.log("\n== Time for one model turn, not for a tool");
    const tight = await turn(Date.now() + LIMITS.timeReserveMs + 5_000);
    check("the model is asked once", tight.modelCalls === 1, tight.modelCalls);
    check("the tool isn't started", !tight.tools.includes("time.now"), tight.tools);
    check("the user is told to say continue", tight.notes.some((n) => n.includes('Send "continue"')), tight.notes);
    check("the run ends as stopped, not failed, logged as a time limit", tight.outcome.status === "cancelled" && tight.reasons.includes("time_limit"), tight);

    console.log("\n== Already past the reserve");
    const late = await turn(Date.now() + 1_000);
    check("no model call at all", late.modelCalls === 0, late.modelCalls);
    check("and the same clear note", late.notes.some((n) => n.includes('Send "continue"')), late.notes);
  } finally {
    await db.delete(agents).where(eq(agents.id, agent.id));
    model.server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
