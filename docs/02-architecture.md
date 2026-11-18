# 2. Architecture

## Big picture

```
                         ┌──────────────────────────── Omnix (Next.js) ───────────────────────────┐
  Browser ──────────────►│  UI: workspace, agents, chat, connections, tasks, runs, approvals      │
                         │                                                                        │
                         │  API routes / server actions                                           │
                         │     │                                                                  │
                         │     ▼                                                                  │
                         │  Agent runner  ──► OpenRouter (any model)                                      │
                         │     │                                                                  │
                         │     ├──► Tool registry ──► Gmail (our own code)                        │
                         │     │                  └──► MCP client ──► remote MCP servers          │
                         │     │                                      (Slack, Notion, Jira…)      │
                         │     └──► Sandbox tools ─────► Agent's E2B VM (code, browser, files)    │
                         └─────┬──────────────────────────────────────────────┬───────────────────┘
                               │                                              │
                    Neon Postgres (Drizzle)                     Inngest (schedules, events,
                    users, agents, connections,                 durable multi-step runs,
                    tasks, runs, approvals…                     waiting for approvals)
```

## Components

| Component | Responsibility | Status |
|---|---|---|
| **Web app** (Next.js App Router) | All UI and API routes | **Decided**, in use |
| **Auth** (NextAuth v4, JWT sessions) | Sign-in with GitHub and Google; users saved to Neon on sign-in | **Decided**, in use |
| **Database** (Neon Postgres + Drizzle ORM) | All persistent data | **Decided**, in use |
| **Model** (OpenRouter via the `openai` SDK) | Reasoning and tool calling | **Decided** (D26), chat route and tool calling built |
| **Agent runner** | One loop that runs any agent: model ⇄ tools, with logging | **Built** (`lib/agent/runner.ts`) — see [agent runtime](04-agent-runtime.md) |
| **Tool registry** | Every tool's name, schema, permission level and code | **Built** (`lib/tools/`): `time.now`, `web.search`, `web.fetch` |
| **Integrations layer** | Gmail built in-house; other apps via an **MCP client** talking to allow-listed remote MCP servers | **Proposed** (MCP-first) — see [integrations](05-integrations.md) |
| **Background jobs** (Inngest) | Scheduled tasks, event triggers, long runs, approval waits | **Decided** (installed; only scaffold examples exist) |
| **Sandboxes** (E2B) | Per-agent VM for code/browser/files, and local MCP servers | **Decided** provider — see [virtual machines](06-virtual-machines.md) |
| **Hosting** (Vercel) | Runs the Next.js app | **Decided** |

## Two ways an agent runs

Both use the **same agent runner**, so behaviour is identical:

1. **Interactive (chat)** — user sends a message → API route runs the agent → reply streams to the browser. Short (seconds to a minute).
2. **Background (task)** — *planned for Phase 4, not built yet.* Schedule or event fires → Inngest function runs the agent step by step → result saved, user notified. Can take minutes or pause for hours waiting for approval.

Rule of thumb: anything that might take longer than ~60 seconds, or needs to survive a server restart, runs in Inngest.

## Request flow: chat turn (today)

1. Browser `POST /api/agents/:id/chat` with the message and its timezone.
2. Server checks the session and that the user owns the agent (`getOwnedAgent`).
3. Saves the user message, loads the last 40 messages.
4. Calls `runAgent()`, which opens a **run**, then loops: model ⇄ tools until it answers
   without asking for another tool. Every model turn and tool call is written to
   `run_steps`.
5. The run's events stream back as NDJSON (decision D23) — reply text, one `activity`
   per tool, and notes that are shown but never saved. The reply is saved when the run ends.
6. The browser renders the text as Markdown with the tool activity above it and, for a
   brand-new chat, puts `?c=<conversation id>` in the address bar without reloading the page.

## Request flow: scheduled task (planned)

1. Inngest cron fires `agent/task.due` for task T.
2. Inngest function loads task + agent + connections, creates a **run** row.
3. Each model call and each tool call is an Inngest `step` (retried individually on failure) and is written to `run_steps`.
4. If a tool needs approval → create an **approval**, notify the user, `step.waitForEvent("approval/decided")`.
5. On finish → mark the run done, deliver the result (in-app, email, or Slack), record usage.

## Tech stack (current)

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack dev) — note: this version has breaking changes vs older docs; check `node_modules/next/dist/docs/` |
| UI | React 19, Tailwind CSS v4, shadcn/ui (`base-nova` style, Base UI primitives), Lucide icons |
| Auth | next-auth 4 (JWT) |
| DB | Neon Postgres, Drizzle ORM 0.45, `postgres` driver |
| AI | OpenRouter via the `openai` SDK, model `deepseek/deepseek-chat-v3.1` (set in `lib/ai.ts`) |
| Jobs | Inngest 3 |
| Avatars | DiceBear `clay` style (by seed) |
| Markdown | `react-markdown` + `remark-gfm`; code blocks highlighted by `shiki` |

## Hosting

**Decided: Vercel** (decision D16). What that means for the design:

- Serverless functions have time limits — fine for chat; anything long or resumable runs through **Inngest**.
- No long-running processes in our functions — **local (stdio) MCP servers can't run here**; use remote MCP servers, or run local ones inside the agent's **E2B** sandbox.
- Secrets live in Vercel's environment variables, not in `.env` files.
- Inngest connects through its Vercel integration; set `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` in production.

## Code layout (current + planned)

```
app/
  (auth)/sign-in, sign-up          sign-in pages
  workspace/                       signed-in app (sidebar layout)
    page.tsx                       home: agents + recent chats
    create-agent/                  create agent form
    agent/[id]/                    agent chat (?c=<conversation> opens a past chat)
    agent/[id]/settings/           edit / delete agent
    actions.ts                     server actions (create / update / delete agent)
  api/
    auth/[...nextauth]/            NextAuth
    agents/[id]/chat/              streaming chat (runs the agent)
    inngest/                       Inngest endpoint
lib/
  auth.ts                          auth config + getCurrentUser()
  agents.ts                        getOwnedAgent(), listConversations()
  ai.ts                            OpenRouter client, model, system prompt
  agent/
    runner.ts                      the agent loop + guard rails (LIMITS)
    events.ts                      the stream's event types, shared with the browser
    runs.ts                        runs / run_steps logging + redaction
    errors.ts                      model errors in plain words
  tools/
    index.ts                       the registry: TOOLS, toolsForAgent, request wiring
    types.ts                       ToolDefinition, ToolContext, risk levels
    schema.ts                      validates the model's arguments
    time.ts, web.ts                the Phase 2 tools
  inngest/                         Inngest client + functions
  -- planned --
  integrations/gmail/              Gmail OAuth + API client
  mcp/                             MCP client, server allow-list, per-user OAuth
  sandbox/                         E2B client
  crypto.ts                        token encryption
db/
  schema.ts                        Drizzle schema (users, agents, conversations,
                                   messages, runs, run_steps)
components/custom/workspace/       app components (sidebar, chat, agent form, Markdown)
docs/                              this plan
```
