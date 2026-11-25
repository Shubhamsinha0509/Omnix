/**
 * Every screen against its reference, at 1440 and 390, light and dark:
 *
 *   npm run compare:all              (needs `npm run dev` running)
 *   npm run compare:all -- 06 07     (only the references whose number starts like that)
 *
 * Agent and run ids are looked up in the database (the first user's oldest agent and its
 * latest run), so it works on any machine with a populated .env. Screens that need an
 * open drawer or menu are clicked open first. Output: design/compare/*.png.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
require("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });

async function ids() {
  const sql = require("postgres")(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const [user] = await sql`select id from users order by id limit 1`;
    if (!user) throw new Error("No users in the database: sign in once first.");
    const [agent] = await sql`select id from agents where user_id = ${user.id} order by created_at limit 1`;
    if (!agent) throw new Error("No agents: create one first.");
    const [run] = await sql`select id from runs where agent_id = ${agent.id} order by started_at desc limit 1`;
    return { agent: agent.id as string, run: (run?.id as string | undefined) ?? null };
  } finally {
    await sql.end();
  }
}

const drawer = (tab: string) => ["--viewport", "--click", "[aria-label='Agent configuration']", "--click", `role=tab[name="${tab}"]`];

async function main() {
  const { agent, run } = await ids();
  const chat = `/workspace/agent/${agent}`;
  const screens: [string, string, string[]?][] = [
    ["01-landing", "/"],
    ["02-auth", "/sign-in"],
    ["03-home", "/workspace"],
    ["04-home-profile-menu", "/workspace", ["--viewport", "--widths", "1440", "--click", "[data-slot=profile-trigger]"]],
    ["05-chat-empty", `${chat}?new=1`],
    ["06-chat-messages", chat],
    ["07-chat-config-instructions", chat, drawer("Instructions")],
    ["08-chat-config-tools", chat, drawer("Tools")],
    ["09-chat-config-schedule", chat, drawer("Schedule")],
    ["10-chat-config-settings", chat, drawer("Settings")],
    ["11-create-agent", "/workspace/create-agent"],
    ["12-agents", "/workspace/agents"],
    ["13-live-run", run ? `${chat}/runs/${run}` : `${chat}/runs`],
    ["14-inbox", "/workspace/inbox?preview=sample"],
    ["15-integrations", "/workspace/integrations"],
    ["16-marketplace", "/workspace/marketplace"],
    ["17-usage-billing", "/workspace/usage"],
    ["18-settings", "/workspace/settings"],
    ["19-success", `${chat}/created`],
    ["20-empty-agents", "/workspace/agents?preview=empty"],
    ["21-chat-run-panel", `${chat}?new=1`, ["--viewport", "--widths", "1440"]],
    ["22-vm-setting-and-task-warning", `${chat}?configure=settings`, ["--viewport", "--widths", "1440"]],
    ["23-landing-pricing", "/"],
  ];

  const only = process.argv.slice(2);
  const selected = only.length ? screens.filter(([ref]) => only.some((prefix) => ref.startsWith(prefix))) : screens;
  let failed = 0;
  for (const [reference, route, extra = []] of selected) {
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", path.join(root, "scripts", "compare.ts"), route, reference, ...extra],
      { stdio: "inherit", cwd: root, env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
    );
    if (result.status !== 0) failed++;
  }
  console.log(failed ? `${failed} screen(s) failed to capture.` : `Done: ${selected.length} screens in design/compare/.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("compare:all failed:", error.message);
  process.exit(1);
});
