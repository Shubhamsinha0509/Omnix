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
| **Tool registry** | Every tool's name, schema, permission level and code | **Built** (`lib/tools/`): `time.now`, `web.search`, `web.fetch`, the four `gmail.*` tools |
| **Integrations layer** | Gmail built in-house; other apps via an **MCP client** talking to allow-listed remote MCP servers | Gmail **built** (`lib/integrations/`); MCP **proposed** — see [integrations](05-integrations.md) |
| **Background jobs** (Inngest) | Scheduled tasks, long runs, approval waits | **Built** (`lib/inngest/`): a minute scheduler, the task runner, a nightly retention sweep. Event triggers come with Phase 5 |
| **Sandboxes** (E2B) | Per-agent VM for code/browser/files, and local MCP servers | **Decided** provider — see [virtual machines](06-virtual-machines.md) |
| **Delivery** (`lib/delivery/`) | A task's result to the in-app inbox and, optionally, by email (Resend over HTTPS) | **Built** (D42, D44); Slack joins it in Phase 5 |
| **Hosting** (Vercel) | Runs the Next.js app | **Decided** |

## Two ways an agent runs

Both use the **same agent runner**, so behaviour is identical:

1. **Interactive (chat)** — user sends a message → API route runs the agent → reply streams to the browser. Short (seconds to a minute).
2. **Background (task)** — **built.** A schedule fires → Inngest runs the agent, each model call and tool call its own durable step → result delivered, user notified. Can take minutes, or sit for a day waiting for an approval (decision D41).

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

## Request flow: scheduled task (today)

1. `task-scheduler` (an Inngest cron, every minute) asks the database for enabled tasks
   whose `next_run_at` has passed, **claims** each one with a conditional `UPDATE` that
   moves its clock forward, and sends one `agent/task.run` event per claim. The event's id
   is the task plus its due time, so the same due time can never run twice (D40).
2. `agent-task-run` loads the task, its agent and its owner, and checks the daily cap on
   background runs (D45). "Run now" enters here too, with `trigger: "manual"`.
3. It calls the **same `runAgent()`** as chat, with a `Durability` adapter that wraps each
   model call and tool call in `step.run`. Inngest remembers the ones that finished, so a
   retry repeats one call rather than the whole run (D41). Everything still lands in
   `run_steps`.
4. If a tool needs approval → an **approval** row, a notification, then
   `step.waitForEvent("approval/decided", { timeout: "24h" })`. The decision runs the
   **stored** payload and the agent carries on in the same run. Nobody answering is told to
   the model as a refusal, so it still finishes and says what it could not do.
5. The run is marked done and the result is delivered: the in-app inbox, an email, or both
   (`lib/delivery/`). A channel that cannot deliver falls back to the inbox.

## Tech stack (current)

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack dev) — note: this version has breaking changes vs older docs; check `node_modules/next/dist/docs/` |
| UI | React 19, Tailwind CSS v4, shadcn/ui (`base-nova` style, Base UI primitives), Lucide icons |
| Auth | next-auth 4 (JWT) |
| DB | Neon Postgres, Drizzle ORM 0.45, `postgres` driver |
| AI | OpenRouter via the `openai` SDK, model `nvidia/nemotron-3-ultra-550b-a55b:free` for testing (D38; set in `lib/ai.ts`) |
| Jobs | Inngest 3 — `lib/inngest/` (scheduler, task runner, retention sweep) |
| Email | Resend HTTP API, no SDK (`RESEND_API_KEY`, `EMAIL_FROM`); optional — D44 |
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
    agent/[id]/tasks/              Tasks tab (+ its server actions)
    agent/[id]/runs/               Runs tab, and one run's timeline
    connections/                   connected accounts
    inbox/                         in-app delivery and background approvals
  api/
    auth/[...nextauth]/            NextAuth
    agents/[id]/chat/              streaming chat (runs the agent)
    approvals/[id]/                decide one approval card
    connections/gmail/             Gmail OAuth start + callback
    inngest/                       Inngest endpoint (serves every function)
lib/
  auth.ts                          auth config + getCurrentUser()
  agents.ts                        getOwnedAgent(), listConversations()
  ai.ts                            OpenRouter client, model, system prompt
  agent-limits.ts                  limits a browser form and the server both need
  tasks.ts                         tasks: CRUD, next_run_at, claiming what is due
  notifications.ts                 in-app delivery + the inbox query
  agent/
    runner.ts                      the agent loop + guard rails (LIMITS)
    durability.ts                  how a run's steps are executed (chat vs Inngest)
    approvals.ts                   the pause, the claim, the card
    events.ts                      the stream's event types, shared with the browser
    runs.ts                        runs / run_steps: logging, redaction, reading back
    errors.ts                      model errors in plain words
  schedule/
    cron.ts                        cron parsing and "when next", in the user's timezone
  tools/
    index.ts                       the registry: TOOLS, toolsForAgent, request wiring
    types.ts                       ToolDefinition, ToolContext, risk levels
    schema.ts                      validates the model's arguments
    selection.ts                   which tools an agent may use, with which account
    time.ts, web.ts, gmail.ts      the tools themselves
  inngest/
    client.ts                      the client and every event's shape
    tasks.ts                       the minute scheduler + the task runner
    retention.ts                   the nightly sweep (D43)
  delivery/
    index.ts                       a result to the inbox and/or email
    email.ts                       Resend over HTTPS
  crypto.ts                        token encryption (AES-256-GCM)
  integrations/
    connections.ts                 the only way tokens are read or written
    access.ts, google.ts, gmail.ts Gmail OAuth, refresh and the API client
  -- planned --
  mcp/                             MCP client, server allow-list, per-user OAuth
  sandbox/                         E2B client
db/
  schema.ts                        Drizzle schema (users, agents, conversations,
                                   messages, runs, run_steps, connections,
                                   agent_tools, approvals, tasks, notifications)
components/custom/workspace/       app components (sidebar, chat, agent form, Markdown,
                                   tasks, run timeline, inbox, approval card)
docs/                              this plan
```
