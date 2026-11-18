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

`CHAT_MODEL` in `lib/ai.ts` is the one place the model is set, as an OpenRouter model id.
It is `deepseek/deepseek-chat-v3.1` today ($0.25 / $0.95 per 1M tokens in/out).

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

## How we work

1. Pick the next unchecked item in the [roadmap](08-roadmap.md).
2. If it needs a decision marked **Open**, decide it first and record it in [decisions](09-decisions.md).
3. Build it, then tick it off in the roadmap and update any doc it changed.
