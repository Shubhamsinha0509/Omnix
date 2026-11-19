# 4. Agent runtime

How an agent actually thinks and acts. **Built** in Phases 2 and 3 (`lib/agent/`, `lib/tools/`)
except where marked otherwise.

## The loop

Every agent run — chat or background task — goes through one function, `runAgent()` in `lib/agent/runner.ts`:

```
runAgent({ agent, input, trigger, history })
  1. Build the system instruction from the agent's instructions
  2. Collect the tools this agent is allowed to use (resolveAgentTools, from agent_tools)
  3. Call the model with: instruction + history + input + tool declarations
  4. If the model asks to call tools:
       for each call:
         - validate the arguments against the tool's schema
         - if the tool needs approval → pause the run (see Approvals)
         - otherwise execute it, log the result
       send the results back to the model, go to 4
  5. When the model answers without tool calls → done; save the answer and usage
```

Guard rails on every run:

| Limit | Starting value | Why |
|---|---|---|
| Max loop iterations | 15 | Stop runaway loops |
| Max tool calls per run | 30 | Cost and API limits |
| Per-tool timeout | 30 s (VM tools: longer) | Don't hang |
| Max output size fed back to the model | 20,000 characters, trimmed with a note | Avoid filling the context with a 5 MB email |
| Per-user daily token / VM budget | from plan (**Phase 7**) | Cost control |

The first four live in `LIMITS` in `lib/agent/runner.ts`. Hitting one is not an error, and
the run finishes with whatever it has:

- **Tool calls:** calls past the limit get an error result the model can read, the limit
  is logged, and the user gets a note. Searches OpenRouter runs server-side count toward
  the same budget, and `web.search` stops being offered once it is spent.
- **Iterations:** if the fifteenth turn asks for tools, those tools run, then the runner
  logs the limit and shows the user a note **without calling the model again** — so the
  model never sees those last results.
- **Timeouts and output size:** the tool's result says what happened (stopped, or
  trimmed) and the model carries on.

Tool calling is the OpenAI format, which OpenRouter speaks for every model (D26): tools
go out as `{ type: "function", function: { name, description, parameters } }`, and the
model replies with `tool_calls`. Three details matter in practice:

- **Names.** Function names don't take dots, so `web.fetch` travels as `web_fetch`
  (`toWireName`). Keys, logs and the UI all use the dotted key.
- **Streamed tool calls arrive in fragments.** A chunk may carry half a function name or
  a few characters of the JSON arguments, keyed by index, so `streamTurn` stitches them
  back together before anything is parsed.
- **Arguments are a JSON string the model wrote**, so they can be malformed. A parse
  failure is handed back to the model as a tool error, not thrown.

### What the runner reports as it goes

`runAgent()` takes an `emit` callback and sends four kinds of event (`lib/agent/events.ts`):
`text` (a piece of the reply), `activity` (a tool starting or finishing), `note`
(something the user should see that isn't part of the reply — a safety refusal, a limit
that was hit) and `approval` (the agent is asking permission; the turn stops there). The
chat route forwards them to the browser as NDJSON (decision D23); background runs in
Phase 4 will log them instead.

Only `text` is saved to the conversation. `activity` and `note` last for the turn (D24).
An `approval` outlives both, in the `approvals` table, because the user may come back to
it tomorrow — so reopening a chat shows any card still waiting in it.

## Tools

A tool is defined once in the **tool registry**:

```ts
type ToolDefinition = {
  key: string;                    // "gmail.search"
  provider?: string;              // "gmail" — needs a connection of this type
  description: string;            // written for the model: what it does and when to use it
  parameters: JSONSchema;         // validated before execution
  risk: "read" | "write" | "destructive";
  runsIn: "server" | "sandbox";   // sandbox tools need the agent's VM
  untrustedOutput?: boolean;      // result contains text written by strangers
  execute(ctx: ToolContext, args: unknown): Promise<ToolResult>;
};
```

The real shape is in `lib/tools/types.ts`; the additions are `label` (what the chat shows
while the tool runs) and `summarise` (the plain-English approval card, see below).

Which tools an agent may use comes from `resolveAgentTools()` in `lib/tools/selection.ts`,
which reads the agent's own grants from `agent_tools` and returns, per tool, **the account
to use and whether approval is required**. Three rules live there:

- **No row means the default**: on for tools needing no account, off for anything that
  reaches a connected one. Least privilege, and existing agents keep what they had.
- **A tool whose account is missing is left out entirely**, not offered and failed — a
  model told it can read email, which then can't, wastes a turn apologising.
- **The risk floor** (D29): `read` never asks, `destructive` always asks, and only `write`
  honours the user's stored preference.

Credentials are not part of that: the resolved tool carries a `connection_id`, and the
token is decrypted one call before it is used, by `openConnection()` in
`lib/integrations/access.ts`, which also refreshes it and marks the connection revoked
when the provider stops accepting it.

**Native tools** are the exception: `web.search` is OpenRouter's `openrouter:web_search`
**server tool** (decision D27), so there is nothing of ours to execute — the model decides
when to search, OpenRouter runs it mid-request and feeds the results straight back. It is
declared as a `NativeToolDefinition` whose whole wire form is its type, and the runner
learns what it did from the `url_citation` annotations and
`usage.server_tool_use_details` on the response, then logs it like any other tool call.

If the provider refuses a server tool, the run doesn't die with it: see D25.

- Tools come from two sources: **built-in** (defined in code, e.g. Gmail, web, sandbox) and **MCP** (loaded from the user's connected, allow-listed MCP servers and wrapped in the same `ToolDefinition` shape, with `risk: "write"` unless we've reviewed the tool as read-only).
- `ctx` carries the user, agent, run id, timezone, an abort signal, and `auth` — the right connection, which decrypts and refreshes its token only when the tool asks for one. Nothing in `ctx` is ever shown to the model.
- **Default approval rule:** `read` → no approval; `write` → approval unless the user turns it off for that agent and tool; `destructive` → always, with no off switch (D29).

### First tools to build

| Tool | Risk | Phase |
|---|---|---|
| `web.search` (OpenRouter server tool), `web.fetch` (ours) | read | 2 — **built** |
| `time.now` (current date/time in the user's timezone) | read | 2 — **built** |
| `gmail.search`, `gmail.read` | read | 3 — **built** |
| `gmail.create_draft` | write | 3 — **built** |
| `gmail.send` | write (approval) | 3 — **built** |
| Slack, Notion, Jira tools (from their MCP servers) | mixed — approval by default | 5 |
| `sandbox.run_code`, `sandbox.browser`, `sandbox.files` | write | 6 |

## Triggers

| Trigger | How | Phase |
|---|---|---|
| **Chat** | User message → API route → `runAgent` (streamed) | built |
| **Manual "Run now"** | Button → Inngest event `agent/task.run` | 4 |
| **Schedule** | One Inngest cron function checks for due tasks every minute and fans out `agent/task.run` events (per-task cron in the user's timezone stored in `tasks`) | 4 |
| **Event** | Webhooks / push notifications (Gmail push via Pub/Sub, Slack Events API) → Inngest event → matching tasks | 5 |

Background runs use Inngest so each model call and tool call is a separate `step.run()` — if step 5 fails, Inngest retries step 5, not the whole run, and steps whose completion Inngest has already recorded are not run again.

That is not a guarantee that an external action happens only once. If a worker dies after a tool has acted (an email went out) but before Inngest records the step as complete, the retry runs the step again and repeats the action. So every tool with an external effect must be **idempotent or reconcilable**: pass an idempotency key derived from the run and step where the provider supports one, or check for the earlier result before acting again (e.g. look for the sent message before re-sending).

## Approvals

**Built** for chat in Phase 3 (`lib/agent/approvals.ts`, `resumeAgent()` in the runner,
`POST /api/approvals/:id`). Background runs get the same table and card in Phase 4.

1. A tool needing approval is about to run → nothing is executed. An `approvals` row is
   written with the **exact validated arguments** and a card: a one-line summary plus the
   action field by field — the real recipient, subject and body (`summarise` on the tool).
2. The run's status becomes `waiting_approval` and the turn **stops there**. Any further
   tool calls the model made in the same turn are answered "not run"; it may ask again
   after the decision. One card at a time, so "Approve" is never ambiguous.
3. The paused turn's model conversation is stored on the row. A chat turn is one HTTP
   request and cannot sit waiting for a click, so the stream ends, the partial reply is
   saved, and the card survives a reload in the `approvals` table (decision D35). Phase 4
   uses Inngest's `step.waitForEvent("approval/decided", { timeout: "24h" })` instead and
   keeps the state in the step.
4. **Approved** → the stored payload runs, not a call the model regenerates. That is the
   security property: what happens is what the card showed, even if the mailbox the agent
   read has changed its mind since. **Rejected or expired** → the model is told it was
   declined and gets to finish.
5. Either way the agent carries on from the stored conversation and streams the rest of
   its reply, which is saved as its own message — so the chat reads reply → card → reply.
   The stored copy of the conversation is deleted as soon as the decision is acted on,
   because it holds whatever the agent had read.

A decision is claimed with one conditional `UPDATE`, so a double-click or a second tab
cannot make the same email go out twice, and resuming takes the conversation lease like
any other turn (D30).

In chat the approval appears inline as a card with Approve / Reject.

## Memory

- **Short-term:** the conversation or run history (built: last 40 messages). Tool calls
  and results stay in the history for the rest of the turn, but only the final reply is
  saved as a message — the next turn starts from the words, not the steps.
- **Long-term (later):** an `agent_memories` table. The agent gets a `memory.save` tool and relevant memories are added to its instructions at the start of a run.

## Results and delivery

A task's final answer is saved on the run and delivered to `deliver_to` (in-app notification, email to the user, or a Slack DM/channel).

## Observability

Everything is already written to `runs` and `run_steps` on every chat turn: model turns,
tool calls with inputs/outputs (secrets redacted), errors, tokens and duration. The UI for
it — a Runs tab per agent — comes with background tasks in Phase 4; until then it is read
with `drizzle-kit studio` or SQL. In chat the user sees the short version live: one line
per tool, with the host it fetched or the searches it ran (decision D24).
