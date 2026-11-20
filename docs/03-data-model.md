# 3. Data model

All tables live in Neon Postgres and are defined in `db/schema.ts` (Drizzle).

## Existing tables (built)

| Table | Purpose | Key columns |
|---|---|---|
| `users` | One row per signed-in person (written on every sign-in) | `id` (serial), `email` (unique), `name`, `image`, `created_at` |
| `agents` | A user's agents | `id` (uuid), `user_id` → users, `name`, `instructions`, `avatar_seed`, `created_at` |
| `conversations` | Chat threads with an agent | `id`, `agent_id` → agents, `user_id` → users, `title`, `busy_until` (lease held while a turn runs — D30), `created_at`, `updated_at` |
| `messages` | Chat messages | `id`, `conversation_id` → conversations, `role` (`user` / `assistant`), `content`, `created_at` |
| `runs` | One row per agent run — a chat turn today, a task run from Phase 4 | `id`, `agent_id` → agents, `user_id` → users, `conversation_id` (nullable), `task_id` (nullable, no foreign key until `tasks` exists), `trigger`, `status`, `error`, `input_tokens`, `output_tokens`, `started_at`, `finished_at` |
| `run_steps` | The timeline inside a run: each model turn, tool call and tool result | `id`, `run_id` → runs, `seq`, `type` (`model` / `tool_call` / `tool_result` / `approval` / `error`), `tool`, `payload` (jsonb, redacted), `created_at` |
| `connections` | A user's authorised accounts (Gmail now, MCP servers from Phase 5) | `id`, `user_id` → users, `provider`, `kind` (`builtin` / `mcp`), `server_url`, `account_label`, `access_token_enc`, `refresh_token_enc`, `scopes` (text[]), `expires_at`, `status` (`active` / `expired` / `revoked`), `created_at`, `updated_at` |
| `agent_tools` | Which tools each agent may use, and with which account | (`agent_id`, `tool`) primary key, `enabled`, `connection_id` → connections (null = any connected account), `approval` (`never` / `always`), `created_at`, `updated_at` |
| `approvals` | An action waiting for the user's agreement, and the paused turn it belongs to | `id`, `run_id` → runs, `user_id` → users, `conversation_id`, `step_id` → run_steps, `tool`, `tool_call_id`, `summary`, `details` (jsonb), `payload` (jsonb — the exact arguments), `resume` (jsonb — the paused model conversation), `status` (`pending` / `approved` / `rejected` / `expired`), `decided_at`, `expires_at`, `created_at` |

Deleting a user cascades to their agents, conversations, messages and runs; deleting a run
cascades to its steps.

`run_steps.payload` is written through `redact()` in `lib/agent/runs.ts`: keys that look
like secrets become `[redacted]` and long strings are trimmed. `vm_seconds` joins `runs`
in Phase 6, when there is a VM to measure.

**`agent_tools` rows are choices, not the whole picture.** With no row a tool falls back to
its default — on for the ones needing no account (`time.now`, `web.*`), off for anything
that reaches a connected account — which is why `enabled` exists as a column as well as
the row: switching `web.search` off is a choice too, and an absent row cannot say it. The
rules live in `resolveAgentTools()` (`lib/tools/selection.ts`), including the risk floor
from D29: `read` never asks for approval and `destructive` always does, whatever `approval`
holds. A `connection_id` is set to null, not deleted, when its account is disconnected, so
the tool reads as "needs an account" rather than vanishing from the agent's settings.

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

### Tasks — what an agent does on its own

| Column | Notes |
|---|---|
| `id`, `agent_id` | |
| `name` | "Morning inbox summary" |
| `prompt` | what to do each run |
| `trigger_type` | `manual` \| `schedule` \| `event` |
| `schedule` | cron expression + `timezone` (for `schedule`) |
| `event` | e.g. `gmail.new_email` with filters (for `event`) |
| `deliver_to` | where results go: in-app, email, Slack channel |
| `enabled` | on/off |

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
