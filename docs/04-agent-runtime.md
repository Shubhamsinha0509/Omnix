# 4. Agent runtime

How an agent actually thinks and acts. **Built** in Phases 2 to 4 (`lib/agent/`, `lib/tools/`,
`lib/inngest/`) except where marked otherwise.

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
chat route forwards them to the browser as NDJSON (decision D23). A background run has
nobody watching, so it ignores `text` and `activity` — `run_steps` already has them, in
more detail — keeps the `note`s to put under the delivered result, and turns an `approval`
into a notification it then waits on.

Only `text` is saved to the conversation. `activity` and `note` last for the turn (D24).
An `approval` outlives both, in the `approvals` table, because the user may come back to
it tomorrow — so reopening a chat shows any card still waiting in it, and a background
run's card waits in the Inbox.

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
| **Manual "Run now"** | Button → `agent/task.run` event → the same Inngest function a schedule uses | built |
| **Schedule** | One Inngest cron checks for due tasks every minute and fans out `agent/task.run` events; the per-task cron is read in the user's timezone from `tasks` (D40) | built |
| **Event** | Webhooks / push notifications (Gmail push via Pub/Sub, Slack Events API) → Inngest event → matching tasks | 5 |

Background runs use Inngest so each model call and tool call is a separate `step.run()` — if step 5 fails, Inngest retries step 5, not the whole run, and steps whose completion Inngest has already recorded are not run again.

How that reaches the one shared runner is a small adapter, not a second loop (decision
D41). `runAgent` takes a `Durability` (`lib/agent/durability.ts`): chat passes
`immediate`, which just runs each piece; the Inngest function passes one whose `step`
is `step.run`. Three consequences are worth knowing before changing this code:

- **A step's result has to survive JSON.** That is why a tool call returns the tool's
  *key* rather than the tool itself, and why anything with a `Date` in it is handed back
  as an ISO string.
- **Code outside a step runs again on every pass.** So every write — the step log, the
  approval row, the limit notes — happens *inside* a step, or it would be written once
  per replay. The step log also takes its sequence numbers from the database rather than
  from a counter in memory, which would restart at zero while half the timeline existed.
- **What a replayed turn streamed is gone.** A memoised turn never calls `onText`, so a
  durable run builds its reply from each turn's stored text instead.

That is not a guarantee that an external action happens only once. If a worker dies after a tool has acted (an email went out) but before Inngest records the step as complete, the retry runs the step again and repeats the action. So every tool with an external effect must be **idempotent or reconcilable**: pass an idempotency key derived from the run and step where the provider supports one, or check for the earlier result before acting again (e.g. look for the sent message before re-sending).

## Approvals

**Built** (`lib/agent/approvals.ts`, `resumeAgent()` in the runner,
`POST /api/approvals/:id`) for chat in Phase 3 and for background runs in Phase 4, which
share the table, the risk rules and the card.

1. A tool needing approval is about to run → nothing is executed. An `approvals` row is
   written with the **exact validated arguments** and a card: a one-line summary plus the
   action field by field — the real recipient, subject and body (`summarise` on the tool).
2. The run's status becomes `waiting_approval` and the turn **stops there**. Any further
   tool calls the model made in the same turn are answered "not run"; it may ask again
   after the decision. One card at a time, so "Approve" is never ambiguous.
3. **In chat**, the paused turn's model conversation is stored on the row: a chat turn is
   one HTTP request and cannot sit waiting for a click, so the stream ends, the partial
   reply is saved, and the card survives a reload in the `approvals` table (decision D35).
   **In a background run** there is nothing to store — the run itself is still there,
   parked on `step.waitForEvent("approval/decided", { timeout: "24h" })` — so the row
   keeps no copy of the turn, and the card is answered from the Inbox. Deciding it records
   the decision and sends the event; the waiting run does the work and finishes the job.
   If that event is ever lost, the 24-hour timeout reads the row before giving up, so a
   decision that was recorded is still honoured.
4. **Approved** → the stored payload runs, not a call the model regenerates. That is the
   security property: what happens is what the card showed, even if the mailbox the agent
   read has changed its mind since. **Rejected or expired** → the model is told it was
   declined and gets to finish.
5. Either way the agent carries on and finishes its turn. In chat it streams the rest of
   its reply, which is saved as its own message — so the chat reads reply → card → reply —
   and the stored copy of the conversation is deleted as soon as the decision is acted on,
   because it holds whatever the agent had read. In a background run the loop simply
   continues, and the finished result is delivered as usual.
6. **Nobody answering is an answer.** After 24 hours the card expires, the model is told
   the action was not allowed, and the agent gets to finish and say what is still waiting.

A decision is claimed with one conditional `UPDATE`, so a double-click or a second tab
cannot make the same email go out twice, and resuming takes the conversation lease like
any other turn (D30).

In chat the approval appears inline as a card with Approve / Reject. For a background
run the same card appears in the Inbox, with the notification that brought it.

## Memory

- **Short-term:** the conversation or run history (built: last 40 messages). Tool calls
  and results stay in the history for the rest of the turn, but only the final reply is
  saved as a message — the next turn starts from the words, not the steps.
- **Long-term (later):** an `agent_memories` table. The agent gets a `memory.save` tool and relevant memories are added to its instructions at the start of a run.

## Results and delivery

**Built** (`lib/delivery/`). A task's final answer is on its run either way, and is
delivered to whichever channels the task names: the in-app Inbox (a `notifications` row,
D42) and/or an email to the user (Resend over HTTPS, D44). Slack joins them in Phase 5.

Two rules make this predictable. Delivery never fails a run — the work and the log are
already done by the time anything is delivered, so a provider being down is reported, not
raised. And a channel that cannot deliver, including email on a server with no email
provider configured, falls back to the Inbox: a result that silently went nowhere would be
worse than one that arrived in the wrong place.

What bounds unattended work is in D45: at most four runs an hour per task schedule, twenty
tasks per agent, and fifty background runs per user per day — past which a run is skipped
and the user is told, rather than the account being quietly drained.

## Observability

Everything is written to `runs` and `run_steps` on every run, chat or background: model
turns, tool calls with inputs/outputs (secrets redacted), errors, tokens and duration.

The **Runs tab** (`/workspace/agent/[id]/runs`) reads it back — the list of runs, and each
one's timeline step by step, including chat turns going back to Phase 2. Payloads are shown
as text and never as Markdown or HTML: a step holds whatever the agent read, and that page
is the one place it is shown in full (see [security](07-security.md)). After 30 days a
step's payload is emptied by the retention sweep and the page says so (D43).

In chat the user sees the short version live: one line per tool, with the host it fetched
or the searches it ran (decision D24).
