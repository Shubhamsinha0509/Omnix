# 8. Roadmap

Each phase ends with something a user can actually do. Tick items as they're finished.

## Phase 0 — Foundation ✅

- [x] Next.js app, Tailwind, shadcn/ui
- [x] Sign in with GitHub (NextAuth), users saved to Neon
- [x] Workspace layout with sidebar and Omnix logo
- [x] Create agent (name, instructions, DiceBear avatar) → saved to Neon
- [x] Sidebar lists the user's agents
- [x] Chat UI with streaming, saved conversations, New chat, Stop
- [x] Model provider connected in code (now OpenRouter — D26)

## Phase 1 — Chat that works ✅

**Done when:** a signed-in user can have a useful conversation with any of their agents.

- [x] Add the model provider's API key and verify replies end to end — verified on Gemini 19 Nov 2026; re-verify on OpenRouter (see [getting the OpenRouter key](README.md#getting-the-openrouter-key))
- [x] Render Markdown in replies (lists, bold, code blocks) — `components/custom/workspace/Markdown.tsx`
- [x] Edit agent (name, instructions, avatar) and delete agent — `agent/[id]/settings`
- [x] Conversation list per agent (switch between past chats) — "Chats" menu in the chat header, `?c=<id>`
- [x] Workspace home page — agents grid + recent chats
- [x] Remove or protect the scaffold `/api/inngest/trigger` route — removed
- [x] Rename `components/custom/wrokspace` → `workspace`

## Phase 2 — Agent runner and first tools ✅

**Done when:** an agent can use tools in chat and you can see what it did.

- [x] `runAgent()` loop with OpenAI-format function calling — `lib/agent/runner.ts` ([runtime](04-agent-runtime.md))
- [x] Tool registry with schema validation and risk levels — `lib/tools/`
- [x] Tools: `time.now`, `web.search` (OpenRouter server tool, D27), `web.fetch`
- [x] `runs` + `run_steps` tables; every chat turn logged — `lib/agent/runs.ts`
- [x] Show tool activity in chat ("Searching the web…") — NDJSON event stream (D23)
- [x] Guard rails: max iterations, timeouts, output trimming — `LIMITS` in `lib/agent/runner.ts`

Verified end to end on Gemini (19 Nov 2026): the agent called `time.now` and answered with
the right date, fetched `example.com` and quoted its heading, and recovered from a 404
mid-run by fetching somewhere else — five model turns in one run, all of it in `run_steps`.

The provider then changed to OpenRouter (D26). The tools, the validator, the request
payload and the run log were re-checked after the port; the live loop needs
`OPENROUTER_API_KEY` to re-verify, and `web.search` has never run successfully (it had no
quota on Gemini's free tier).

## Phase 3 — Gmail end to end

**Done when:** "summarise my unread email" works in chat, and sending requires approval.

- [x] `connections` table + token encryption (`lib/crypto.ts`) — plus `lib/integrations/connections.ts`, the only way tokens are read or written
- [x] Connect / disconnect Gmail (separate OAuth from sign-in), token refresh — `app/api/connections/gmail/`, `lib/integrations/google.ts`; refresh and revocation handling in `lib/integrations/access.ts`
- [x] Tools: `gmail.search`, `gmail.read`, `gmail.create_draft`, `gmail.send` — `lib/tools/gmail.ts` over `lib/integrations/gmail.ts`
- [x] Approvals: table, inline approval card in chat, execute stored payload — `lib/agent/approvals.ts`, `resumeAgent()`, `POST /api/approvals/:id` (decision D35)
- [x] Agent settings → Tools: choose tools + connection per agent — `agent_tools` table, `resolveAgentTools()`, `components/custom/workspace/AgentTools.tsx`
- [x] Connections page — `/workspace/integrations`
- [x] Google Cloud set up: Gmail API enabled, consent screen in Testing, test users added, redirect URI registered, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env` — steps in [connecting Gmail](README.md#connecting-gmail)
- [ ] Walk the live loop against a real mailbox: connect → search → read → draft → send with an approval
- [ ] Start reading Google's verification requirements (restricted scopes + CASA) — see [security](07-security.md#google-verification)
- [ ] Switch back to a paid model before any of this touches a real inbox (D34) — **not done**: `CHAT_MODEL` in `lib/ai.ts` is still the free `:free` model (D38, no OpenRouter credit), so email an agent reads goes to a provider that may log prompts

### What is verified, and what isn't

Checked without Google credentials: the whole thing compiles and builds, both new tables
match the schema, and the pure logic has been exercised directly — the header-injection
guard on recipients (CRLF, bare newlines, multiple addresses and unbalanced brackets are
all refused), HTML-to-text flattening, the tool schemas' caps, and the approval card's
contents.

**Not yet run against a live mailbox.** The Google Cloud side is now in place — Gmail API
enabled, test users added, redirect URI registered, credentials in `.env` — so the flow is
ready to try. Until someone walks it — connect → search → read → draft → send with an
approval — the OAuth exchange, token refresh, real-world MIME parsing and the pause/resume
path are code that type-checks rather than code that is known to work.

## Phase 4 — Tasks (agents work on their own) ✅

**Done when:** "every weekday at 9:00, summarise my inbox" runs without the user, and the result shows up.

- [x] `tasks` table; Tasks tab on each agent (create/edit/enable) — `db/schema.ts`, `lib/tasks.ts`, `/workspace/agent/[id]/tasks`, also the Schedule tab of the panel beside the chat
- [x] Inngest function that runs a task with each step durable — `lib/inngest/tasks.ts`; the runner takes a `Durability` adapter so chat and tasks stay one loop (D41)
- [x] Scheduler (cron in the user's timezone) + "Run now" — a minute cron claims due tasks and fans them out (D40); the cron maths, with DST, is `lib/schedule/cron.ts`
- [x] Approvals in background runs (`waitForEvent`, 24 h expiry) + in-app notifications — the run waits and carries on; cards appear in the Inbox (D41, D42)
- [x] Runs tab: timeline of each run — `/workspace/agent/[id]/runs`, step by step, including chat turns going back to Phase 2
- [x] Delivery: in-app and email — `lib/delivery/`; email is Resend over HTTPS and falls back to the inbox (D44)
- [x] Answered the two open questions this phase gated: run-log retention (D43) and what bounds unattended spend until the budget is set (D45)

### What is verified, and what isn't

**Walked live on 20 Nov 2026**, against the real database and a local Inngest dev server:

- **"Run now"** — the event reached `agent-task-run`, which ran the agent as four durable
  steps (model turn → `time.now` call → its result → model turn), answered with the right
  local time, finished in 17s and delivered the result to the Inbox.
- **The schedule** — a task due 30 seconds ago was claimed by the minute cron, ran with
  `trigger: "schedule"`, had its `next_run_at` advanced to the next quarter hour and its
  `last_run_at` set, and a tick immediately afterwards claimed nothing.
- **The queries behind the UI** — 31 checks against the live database: creating and editing
  tasks, the next run computed in `Asia/Kolkata`, disabling clearing the clock, two
  simultaneous scheduler ticks claiming the same task exactly once, the inbox and its
  unread count, `listRuns`/`getRunDetail` over runs from Phase 2, and a different user's id
  seeing none of it.
- **The approval row's state machine** — 13 checks: one decision claimed, a second click
  getting nothing, the stored payload handed back unchanged, an overdue card refusing to be
  claimed and then reading as expired. This is what the 24-hour wait and its lost-event
  fallback rest on.
- **The cron engine** — 44 cases, including both daylight-saving edges in New York (the
  skipped 02:30 still runs), half-hour and 45-minute zones, "every weekday" from a Friday
  evening, and schedules that can never happen.

Three things are built but **not yet watched end to end**:

- **An approval inside a background run.** The row-level machinery is tested and the wait
  is wired, but nobody has yet let a task ask for `gmail.send`, answered the card in the
  Inbox and seen the agent carry on. It needs a Gmail write tool switched on, which touches
  a real mailbox — do it with the Phase 3 walk-through.
- **Email delivery.** No `RESEND_API_KEY` is set, so what is proven is the fallback: the
  result went to the Inbox and said why email didn't.
- **A step being retried.** Inngest's own retry path hasn't been forced.

One caveat worth repeating: a task run uses the same model as chat, which is still the free
`:free` one (D38). Unattended runs now send prompts — and anything the agent reads — to
that provider with nobody watching, which makes switching back to a paid model (D34) more
pressing than it was in Phase 3, not less.

## Phase 5 — More integrations

**Done when:** agents can use Slack, Notion and Jira.

Notion and Jira are built and connectable; Slack is built but cannot be connected until
there is a Slack app (D48), and event triggers are not started.

- [x] Spike: confirm Slack, Notion and Jira have usable official remote MCP servers with OAuth → D17 confirmed as D46; findings in [integrations](05-integrations.md#the-phase-5-spike-22-november-2026). No fallback needed for these three; Slack is the awkward one — it refuses dynamic client registration and allows only Marketplace-published or workspace-internal apps (D48)
- [x] MCP client in the agent runner (remote HTTP servers), tool list caching — `lib/mcp/client.ts` over the official v2 SDK (D47), with the protocol era negotiated per connection; the list is cached in `mcp_tool_cache` and refreshed hourly by `lib/inngest/mcp.ts`, on connect, and by **Refresh tools** on the tile
- [x] MCP server allow-list (`lib/mcp/servers.ts`) and per-user MCP OAuth connections — Notion and Jira register Omnix dynamically and need no configuration; Slack needs an app (D48). Tokens live in `connections` (`kind: "mcp"`), encrypted like Gmail's (D13); the connect flow is `app/api/connections/mcp/`
- [x] Approval-by-default for MCP tools; reviewed read-only list per server — a tool is `write` unless its name is in that server's `readOnlyTools`, and the server's own `readOnlyHint` is deliberately not consulted
- [x] Notion via MCP — all 20 tiles, agent tool settings grouped by server, and `/workspace/integrations` connect and disconnect (with revocation where the server publishes an endpoint)
- [x] Jira via MCP — same flow; its server is still on a 2025-era protocol revision, which the era negotiation handles rather than a special case
- [ ] Walk a connected account end to end: sign in at the consent screen → `tools/list` → a read tool in chat → a write tool with an approval
- [ ] Slack via MCP (also as a delivery channel for task results) — **blocked**: Slack's MCP server has no dynamic client registration and allows only a Marketplace-published or workspace-internal app, with admin approval (D48). The allow-list entry, scopes and connect flow are built and the tile says why it is disabled; its `readOnlyTools` list is deliberately empty until a real `tools/list` can be seen, so every Slack tool would ask
- [ ] Event triggers (new email via Gmail push, Slack events) — not started. Both legs need infrastructure that doesn't exist yet: a Google Cloud Pub/Sub topic and a verified webhook for Gmail, and a Slack app for Slack events. `tasks.trigger` would also gain `event`, plus an `event` jsonb column ([data model](03-data-model.md#tasks--event-triggers))

### What is verified, and what isn't

**Checked against the real servers, 22 Nov 2026** — 98 checks, no user account needed.
Re-run them with `npm run verify:mcp -- --live` (`scripts/verify-mcp.ts`):

- **Discovery, registration and consent URLs are real.** Against `mcp.notion.com` and
  `mcp.atlassian.com`, the client walked RFC 9728 protected-resource metadata, registered
  Omnix dynamically (both issued a `client_id` and secret, now stored encrypted in
  `mcp_clients`), and produced an authorization URL carrying a PKCE `S256` challenge, our
  own redirect URI, the RFC 8707 `resource` parameter naming the server, and **our** seven
  Jira scopes rather than the forty the server lists. The issuer each flow resolved was
  recorded for the RFC 9207 check on the way back.
- **The connect flow is single-use and per-user.** A flow is claimed by `state` *and* user
  id, and the claim deletes it: another user's id finds nothing, a second claim finds
  nothing, and an expired row is refused.
- **Credentials are encrypted and bound.** A registration secret is unreadable in the row,
  carries the `v1:` prefix, and will not decrypt under another issuer's AAD.
- **The tool mapping is safe by default.** From a cached list: a reviewed read is
  `risk: "read"`, everything else — including a delete tool — is `write` and asks;
  `executeWrite` and `executeDestructive` are not in Jira's read list; a tool name that
  can't be put on the wire is dropped rather than mangled; every MCP tool is marked
  untrusted; descriptions are attributed to their server; and an approval card shows the
  tool, the server and the real arguments.
- **Arguments are not mangled.** The loose checker keeps undeclared and deeply nested
  properties intact (the strict one drops them, which is why MCP tools don't use it) and
  refuses a non-object, a missing required field, or 70 KB of arguments.
- **A connected server grants nothing by itself.** Its tools appear in the agent's settings
  switched off, and a run offers none of them until one is turned on.

**Not yet done against a live account.** Nobody has signed in at a consent screen, so the
code exchange, `tools/list`, `tools/call`, the token refresh and the approval path for an
MCP tool are code that type-checks and is unit-checked, not code that is known to work —
the same position Phase 3 is in with Gmail. The two should be walked together.

Also unproven: Slack anything (see above), and the `legacy` protocol era in practice —
Atlassian's CORS headers say it still uses sessions, and `mode: "auto"` is written to fall
back, but the fallback has only been exercised as far as the auth wall.

## Phase 6 — Dedicated VMs

**Done when:** a user can switch an agent to "Dedicated VM" and it can run code and use a browser.

- [ ] Spike: confirm E2B covers browser, network allow-lists, pause/resume and pricing for our needs (API confirmed from E2B's docs and SDK types; allow-lists and pricing still open)
- [x] `sandboxes` table; E2B create / pause / resume / destroy lifecycle (`lib/sandbox`, D50). Verified live against E2B on 2026-11-24 (`npm run verify:vm -- --live`, 20 checks: start in ~8.5 s, one VM for two clicks, pause and resume keep files, stop deletes it)
- [x] Tools: `sandbox.run_code` (python, bash), `sandbox.write_file` / `read_file` / `list_files`, `sandbox.open_browser` (D52). Off by default; switched on per agent in the Tools tab. Verified live by calling each tool against a real VM, and in a real chat on 2026-11-24 (cody wrote Python, asked for approval, ran it and read its result file back). Code runs are also shown in a terminal window on the VM's screen
- [x] Runtime toggle in agent settings; VM status indicator. The Isolated VM switch in Settings turns all VM tools on or off, with "Run code without asking" (D53); status and controls are in the chat's run panel (`VmCard`). Checked in the app on 2026-11-24
- [x] VM know-how in the system prompt, a folder per scheduled task, and a warning on tasks that would wait for approval (D53). Not yet exercised by a model: the free OpenRouter quota ran out
- [ ] VM usage tracked per run (per user and month is built, D55: `vm_usage`, enforced against the plan; not yet attributed to individual runs)

## Phase 7 — Ready to launch

- [ ] Usage tracking + per-plan limits; usage page
- [ ] Billing (**Open**: pricing model)
- [ ] Marketplace: publish agent as template, install template (no credentials copied)
- [ ] Long-term memory
- [ ] Security checklist complete ([security](07-security.md#checklist-before-any-public-deployment))
- [ ] Google verification complete (for public Gmail)
- [ ] Switch to `drizzle-kit generate` + `migrate`
- [ ] Production deployment, monitoring, error tracking

## Later

- Team workspaces (not in v1 — see decision D14)
- Multi-agent handoffs
- Let users add their own MCP server URLs (beyond the allow-list)
- Local (stdio) MCP servers running inside E2B sandboxes
- Mobile-friendly approvals (push notifications)
