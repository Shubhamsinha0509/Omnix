# Omnix — Project Plan

Omnix lets people create AI agents, give them tasks (for example "read my emails every morning and summarise them"), connect them to tools such as Gmail, Slack, Notion and Jira, and optionally run each agent on its own virtual machine.

These documents are the plan we build from. Read them before starting a new feature, and update them when a decision changes.

| # | Document | What it covers |
|---|---|---|
| 1 | [Product vision](01-product-vision.md) | What Omnix is, who it's for, core concepts, what "done" looks like |
| 2 | [Architecture](02-architecture.md) | System components, how a request flows, tech stack |
| 3 | [Data model](03-data-model.md) | Database tables — what exists today and what's planned |
| 4 | [Agent runtime](04-agent-runtime.md) | The agent loop, tools, triggers, approvals, memory |
| 5 | [Integrations](05-integrations.md) | Connecting Gmail, Slack, Notion, Jira and more |
| 6 | [Virtual machines](06-virtual-machines.md) | Running an agent in its own isolated sandbox |
| 7 | [Security](07-security.md) | Threats (especially prompt injection) and how we handle them |
| 8 | [Roadmap](08-roadmap.md) | Phases, tasks, and how we know each phase is done |
| 9 | [Decisions](09-decisions.md) | Log of technical decisions and why we made them |
| 10 | [Open questions](10-open-questions.md) | Things we still need to decide |

## Status labels used in these docs

- **Built** — written, in the code, and working.
- **Decided** — chosen and already in the code, or agreed.
- **Proposed** — recommended, waiting for agreement before building.
- **Open** — not decided yet; listed in [open questions](10-open-questions.md).

## Getting the OpenRouter key

The app needs one key to work: `OPENROUTER_API_KEY`. Without it every chat returns
"AI isn't set up yet" (`hasModelKey()` in `lib/ai.ts`).

1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and create a key.
2. Put it in `.env` — `OPENROUTER_API_KEY=sk-or-…`. `.env` is gitignored; never commit it.
3. Add a few dollars of credit at [openrouter.ai/credits](https://openrouter.ai/credits).
   Paid models and `web.search` both draw on it.
4. Restart `npm run dev`. Next.js reads `.env` at boot, so a running server won't pick it up.
5. Check the pieces separately — the "Searching the web" line in chat proves none of them
   on its own:
   - **A local tool call:** ask "what's the date today?" or "read https://example.com".
     Chat shows a "Reading the page" (or time) line, and the answer uses the result —
     that is our own function-calling path, end to end.
   - **The run log:** confirm the turn was recorded — a new row in `runs` with
     `status = 'succeeded'` and its `run_steps` (`npm run db:studio`, or
     `select type, tool from run_steps order by created_at desc limit 10;`).
   - **Web search:** ask something only the web knows ("what's in the news today?"). It
     worked if the reply cites sources and `run_steps` has a `web.search` tool_call row.

### Choosing the model

Set `OPENROUTER_MODEL` in `.env` to an OpenRouter model id, then restart `npm run dev`.
That one setting applies to every agent; no code change is needed (D39). Left empty, the
free default in `lib/ai.ts` is used (`nvidia/nemotron-3-ultra-550b-a55b:free`, D38). The
paid model we recommend is `deepseek/deepseek-chat-v3.1` ($0.25 / $0.95 per 1M tokens
in/out), which needs credit on the account. The free `:free` models are fine for poking at the chat, but don't
point one at a real inbox: they are rate limited in a way an agent loop feels, and a free
provider may log the prompts — which from Phase 3 contain somebody's email (D32, D34).

One key reaches every model, so switching is a one-line change — that is the main reason
we are on OpenRouter (decision D26). Browse ids and prices at
[openrouter.ai/models](https://openrouter.ai/models); the catalogue is also readable as
JSON from `https://openrouter.ai/api/v1/models`, which is handy for checking what a model
costs and whether it supports tool calling before switching to it:

```bash
curl -s https://openrouter.ai/api/v1/models | jq '.data[] | select(.id=="deepseek/deepseek-chat-v3.1") | {id, pricing, supported_parameters}'
```

**The model must support tool calling.** Of 478 models, 415 do — check for `"tools"` in
its `supported_parameters` before picking one, or the agent loses every tool it has. Free
`:free` models exist and work, but they are rate limited and unproven for agent loops.

### What costs money

- **Tokens**, at the chosen model's rate.
- **`web.search`**, billed per search on top of tokens (decision D27) — the default Exa
  engine is around $0.007 a search for up to 10 results. The model decides when to search,
  so a chatty agent can run several in one answer. `run_steps` records **one aggregated**
  `web.search` tool_call and tool_result per model turn (with the count), not a row per
  search, so it is not a billing ledger — reconcile spend against OpenRouter's own usage
  page.
- **`web.fetch` is free** — it is our own code, not a server tool (decision D28).

If the account runs dry, OpenRouter answers with **402** and the chat says so in plain
words rather than failing silently (`lib/agent/errors.ts`).

## Connecting Gmail

Gmail is a **separate** OAuth from signing in (D36): signing in says who you are,
connecting Gmail lets an agent into your mailbox. Both use the same Google OAuth client by
default, so there is one thing to set up.

The scopes are Google **restricted scopes**, which means that until the app is verified it
works only for accounts you have added as test users — up to 100 of them.

### In Google Cloud Console

1. Open your project → **APIs & Services**.
2. **Enable the Gmail API** (Library → "Gmail API" → Enable). Nothing works without this.
3. **OAuth consent screen** → set User type to *External*, and leave the publishing status
   as **Testing**.
4. **Audience → Test users** → add every Google account you want to connect, including
   your own. An account that isn't on this list gets "access blocked" at the consent
   screen, and that is the single most common reason connecting fails.
5. **Data access → Add or remove scopes** → add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
6. **Credentials → your OAuth 2.0 Client ID** → under *Authorised redirect URIs* add:
   - `http://localhost:3000/api/connections/gmail/callback`
   - and the same path on your deployed origin when you have one.

   It must match exactly — Omnix builds the URI from `NEXT_PUBLIC_APP_URL`, not from the
   incoming request, so those two have to agree.

### In Omnix

1. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` (the same pair sign-in uses).
   To keep them separate, set `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` as well and they
   win — worth doing before verification, so a restricted-scope review can't hold up
   sign-in.
2. `TOKEN_ENCRYPTION_KEY` must be set, or the token can't be stored and the connect flow
   stops before it starts. Generate one with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Restart `npm run dev` — `.env` is read at boot.
4. **Connections** in the sidebar → **Connect Gmail** → approve, leaving both boxes
   ticked. You come back to the page with the address shown. (Unticking a box is allowed:
   the page says what is missing and the affected tools refuse with an explanation.)
5. Open an agent → **Settings → Tools** → switch on the Gmail tools you want. Connecting
   an account gives no agent access on its own; this second step is the point.

### Walking the loop

1. **Read:** "summarise my unread email from the last two days". The chat shows
   "Searching email", then "Reading email" per message.
2. **Draft:** "draft a reply to the one from X saying I'll look tomorrow". With approval
   left on you get a card first; approve it and the draft appears in Gmail's Drafts.
3. **Send:** "send it". The card shows the real recipient, subject and body — check it is
   the actual text and not the agent's description of it — then Approve. Reject on a card
   must leave the mailbox untouched.
4. **The log:** `npm run db:studio`, or
   `select type, tool, created_at from run_steps order by created_at desc limit 20;`.
   An approved send has an `approval` step between its `tool_call` and `tool_result`.

### Before Google verification

Public Gmail access needs consent-screen verification **and** an annual third-party
security assessment (CASA) — weeks and real money. Read Google's current requirements
early; they gate launch, not development. See
[security](07-security.md#google-verification).

## Running tasks locally

Tasks are Inngest functions, and Inngest is what calls them. In development that means a
**second terminal**:

```bash
npm run dev           # terminal 1
npm run inngest:dev   # terminal 2 — discovers http://localhost:3000/api/inngest
```

No keys are needed locally. Without the second terminal, nothing is broken and nothing
runs: "Run now" says it couldn't reach the background job service, and a schedule simply
never fires. The dev server's dashboard (it prints the URL, usually
<http://localhost:8288>) shows every run step by step, which is the fastest way to see
where one stopped.

**Restart `next dev` after changing `db/schema.ts`.** A dev server that has been running
since before the change can keep a stale copy of the schema module and fail inside a job
with something unhelpful like `Cannot read properties of undefined (reading 'id')`. The
code is fine; the process isn't. This bit us once already.

Three functions are served (`lib/inngest/functions.ts`):

| Function | Trigger | What it does |
|---|---|---|
| `task-scheduler` | cron, every minute | Claims tasks whose `next_run_at` has passed and fans out one event each (D40) |
| `agent-task-run` | `agent/task.run` | Runs one task: the agent, each step durable, then delivery (D41) |
| `retention-sweep` | cron, 04:10 UTC | Empties run-step payloads older than 30 days (D43) |

### Walking a task

1. **Run now.** Open an agent → **Tasks** → New task. Name it, write "What is the date and
   time right now?", pick any schedule, leave the inbox ticked, create it, then press **Run
   now**. Within a second or two the Inngest dashboard shows `agent-task-run`, the agent's
   **Runs** tab shows a run with trigger "Run now", and the result appears in **Inbox**
   (the sidebar counts it).
2. **A real schedule.** Edit the task to **Custom (cron)** a couple of minutes from now —
   e.g. `37 14 * * *` for 14:37 — and check the form's "next run" line reads the time you
   meant *in your timezone*. Leave it alone and watch it fire on its own; that is the whole
   phase working.
3. **An approval.** Give the agent `gmail.send` with "Ask me before this runs" on, and a
   task like "draft and send a one-line hello to my own address". The run stops, a card
   turns up in the Inbox with the real recipient and body, and **Approve** makes the agent
   finish the job and deliver its reply. **Reject** leaves the mailbox untouched. A card
   nobody answers expires after 24 hours and the agent is told it wasn't allowed.
4. **The log.** The run's page lists every step — model turns, tool calls, the approval and
   what it returned.

### Emailing results (optional)

A task can deliver to your email as well as the Inbox. That needs two settings:

```env
RESEND_API_KEY=re_...
EMAIL_FROM="Omnix <omnix@your-verified-domain.com>"
```

Get the key at [resend.com/api-keys](https://resend.com/api-keys) and verify a sending
domain first — Resend will refuse a `from` address on a domain you don't own. With these
unset, nothing is lost: the task says so and the result goes to the Inbox instead (D44).
Omnix emails **you**, never anybody else; an agent emailing somebody is `gmail.send`,
which needs a connected account and an approval card.

## How we work

1. Pick the next unchecked item in the [roadmap](08-roadmap.md).
2. If it needs a decision marked **Open**, decide it first and record it in [decisions](09-decisions.md).
3. Build it, then tick it off in the roadmap and update any doc it changed.
