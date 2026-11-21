# 3. Data model

All tables live in Neon Postgres and are defined in `db/schema.ts` (Drizzle).

## Existing tables (built)

| Table | Purpose | Key columns |
|---|---|---|
| `users` | One row per signed-in person (written on every sign-in) | `id` (serial), `email` (unique), `name`, `image`, `created_at` |
| `agents` | A user's agents | `id` (uuid), `user_id` → users, `name`, `instructions`, `avatar_seed`, `created_at` |
| `conversations` | Chat threads with an agent | `id`, `agent_id` → agents, `user_id` → users, `title`, `busy_until` (lease held while a turn runs — D30), `created_at`, `updated_at` |
| `messages` | Chat messages | `id`, `conversation_id` → conversations, `role` (`user` / `assistant`), `content`, `created_at` |
| `runs` | One row per agent run — a chat turn, or a task run from the schedule or "Run now" | `id`, `agent_id` → agents, `user_id` → users, `conversation_id` (nullable), `task_id` (nullable → `tasks`, `set null`), `trigger`, `status`, `error`, `input_tokens`, `output_tokens`, `started_at`, `finished_at` |
| `run_steps` | The timeline inside a run: each model turn, tool call and tool result | `id`, `run_id` → runs, `seq`, `type` (`model` / `tool_call` / `tool_result` / `approval` / `error`), `tool`, `payload` (jsonb, redacted), `created_at` |
| `connections` | A user's authorised accounts (Gmail now, MCP servers from Phase 5) | `id`, `user_id` → users, `provider`, `kind` (`builtin` / `mcp`), `server_url`, `account_label`, `access_token_enc`, `refresh_token_enc`, `scopes` (text[]), `expires_at`, `status` (`active` / `expired` / `revoked`), `created_at`, `updated_at` |
| `agent_tools` | Which tools each agent may use, and with which account | (`agent_id`, `tool`) primary key, `enabled`, `connection_id` → connections (null = any connected account), `approval` (`never` / `always`), `created_at`, `updated_at` |
| `tasks` | What an agent does on its own: an instruction plus when to run it | `id`, `agent_id` → agents, `user_id` → users, `name`, `prompt`, `trigger` (`manual` / `schedule`), `schedule` (five-field cron), `timezone`, `deliver` (text[]: `inapp`, `email`), `enabled`, `next_run_at`, `last_run_at`, `created_at`, `updated_at` |
| `notifications` | In-app delivery: a task's result, a failure, or a background run waiting for approval | `id`, `user_id` → users, `kind` (`task_result` / `task_failed` / `approval_request`), `title`, `body`, `agent_id`, `task_id`, `run_id`, `approval_id` → approvals, `read_at`, `created_at` |
| `approvals` | An action waiting for the user's agreement, and the paused turn it belongs to | `id`, `run_id` → runs, `user_id` → users, `conversation_id`, `step_id` → run_steps, `tool`, `tool_call_id`, `summary`, `details` (jsonb), `payload` (jsonb — the exact arguments), `resume` (jsonb — the paused model conversation), `status` (`pending` / `approved` / `rejected` / `expired`), `decided_at`, `expires_at`, `created_at` |

Deleting a user cascades to their agents, conversations, messages and runs; deleting a run
cascades to its steps.

`run_steps.payload` is written through `redact()` in `lib/agent/runs.ts`: keys that look
like secrets become `[redacted]` and long strings are trimmed. It is also **emptied after
30 days** by the nightly retention sweep, which replaces the payload with
`{"purged": true}` and keeps the row (D43) — the shape of a run is cheap and useful for
ever, its contents are somebody's email. Notifications are deleted outright after 90 days.
`vm_seconds` joins `runs` in Phase 6, when there is a VM to measure.

**`agent_tools` rows are choices, not the whole picture.** With no row a tool falls back to
its default — on for the ones needing no account (`time.now`, `web.*`), off for anything
that reaches a connected account — which is why `enabled` exists as a column as well as
the row: switching `web.search` off is a choice too, and an absent row cannot say it. The
rules live in `resolveAgentTools()` (`lib/tools/selection.ts`), including the risk floor
from D29: `read` never asks for approval and `destructive` always does, whatever `approval`
holds. A `connection_id` is set to null, not deleted, when its account is disconnected, so
the tool reads as "needs an account" rather than vanishing from the agent's settings.

**`tasks.next_run_at` is the whole of the schedule, as far as the scheduler is concerned.**
It is an exact instant, computed from the cron expression *in the task's timezone* whenever
the task changes, and advanced as each run is claimed (D40). The scheduler's only query is
"enabled tasks whose `next_run_at` has passed", which the `tasks_due_idx` index answers; the
cron arithmetic lives in `lib/schedule/cron.ts` and nowhere else. Null means "not waiting on
the clock" — disabled, manual-only, or a schedule that can never come round.

**A run outlives its task.** Deleting a task sets `runs.task_id` to null rather than
deleting the runs: what an agent did is the audit log, and it should not disappear because
somebody tidied up a schedule. The same goes for `notifications.task_id`.

**`approvals.payload` is what actually runs**, not a call the model regenerates after the
click — that is the whole security property (D35). `approvals.resume` is the paused turn's
model conversation, kept only because a chat turn is one HTTP request and cannot wait; it
holds whatever the agent had read, so it is cleared the moment the decision is acted on.

**Connections are only reached through `lib/integrations/connections.ts`.** Every lookup
there takes a `user_id`, and decrypted tokens leave through exactly one function,
`getCredentials()` — everything a page or route can call returns a `SafeConnection` with
no token material in it. A unique index on (`user_id`, `provider`, `account_label`) makes
reconnecting the same account update that row, while still allowing a second, different
account of the same provider.

## Planned tables

Status: **Proposed**. Columns are a starting point and will change as we build.

### Agents (extend the existing table)

| New column | Type | Why |
|---|---|---|
| `model` | text, nullable | Per-agent model override; null = default in `lib/ai.ts` |
| `runtime` | `shared` \| `vm` | Whether tools run on our server or the agent's own VM |
| `status` | `active` \| `paused` | Pause an agent without deleting it |
| `updated_at` | timestamp | Edits |

### MCP server catalog

The allow-list of MCP servers users can connect. Can start as a constant in code (`lib/mcp/servers.ts`) and move to a table later: `id`, `name`, `server_url`, `auth` (OAuth details), `read_only_tools` (tools *we* have reviewed as safe without approval), `enabled`.

### Tasks — event triggers

`tasks` is **built** (above) with `manual` and `schedule` triggers. The third kind, an
event trigger — `gmail.new_email` with filters, a Slack message — arrives with Phase 5,
and needs one more column (`event`, jsonb) plus the webhook that feeds it. The runner and
delivery it would use are already there.

### Memory

`agent_memories`: `id`, `agent_id`, `content`, `source` (run/conversation), `created_at`. Later: embeddings for search.

### Sandboxes

`sandboxes`: `agent_id` (one per agent), `provider`, `external_id`, `status` (`running` / `paused` / `stopped`), `last_active_at`.

### Usage and limits

`usage_daily`: `user_id`, `date`, `input_tokens`, `output_tokens`, `tool_calls`, `vm_seconds`. Used to enforce plan limits and show usage.

### Marketplace (later)

`agent_templates`: `id`, `author_id`, `name`, `description`, `instructions`, `avatar_seed`, `tools` (tool keys only — **never** connections or tokens), `published`, `installs`.

## Ownership

**Decided: individuals only** (D14). Every agent, connection, task and run belongs directly to a `user_id`. If teams are added later, they need a `workspaces` table and a migration of these tables.

## Migrations

**Decided for now:** `drizzle-kit push` during early development.
**Proposed before launch:** switch to `drizzle-kit generate` + `migrate` so every schema change is a reviewed SQL file in git. (We already hit a case where `push` stops to ask whether a column was renamed.)
