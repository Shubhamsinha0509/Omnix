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
- [x] Connections page — `/workspace/connections`
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

## Phase 4 — Tasks (agents work on their own)

**Done when:** "every weekday at 9:00, summarise my inbox" runs without the user, and the result shows up.

- [ ] `tasks` table; Tasks tab on each agent (create/edit/enable)
- [ ] Inngest function that runs a task with each step durable
- [ ] Scheduler (cron in the user's timezone) + "Run now"
- [ ] Approvals in background runs (`waitForEvent`, 24 h expiry) + in-app notifications
- [ ] Runs tab: timeline of each run
- [ ] Delivery: in-app and email

## Phase 5 — More integrations

**Done when:** agents can use Slack, Notion and Jira.

- [ ] Spike: confirm Slack, Notion and Jira have usable official remote MCP servers with OAuth → confirm D17, decide fallback for any gaps
- [ ] MCP client in the agent runner (remote HTTP servers), tool list caching
- [ ] MCP server allow-list (`lib/mcp/servers.ts`) and per-user MCP OAuth connections
- [ ] Approval-by-default for MCP tools; reviewed read-only list per server
- [ ] Slack via MCP (also as a delivery channel for task results)
- [ ] Notion via MCP
- [ ] Jira via MCP
- [ ] Event triggers (new email via Gmail push, Slack events)

## Phase 6 — Dedicated VMs

**Done when:** a user can switch an agent to "Dedicated VM" and it can run code and use a browser.

- [ ] Spike: confirm E2B covers browser, network allow-lists, pause/resume and pricing for our needs
- [ ] `sandboxes` table; E2B create / pause / resume / destroy lifecycle
- [ ] Tools: `sandbox.run_code`, `sandbox.files`, `sandbox.browser`
- [ ] Runtime toggle in agent settings; VM status indicator
- [ ] VM usage tracked per run

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
