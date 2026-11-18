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

Deleting a user cascades to their agents, conversations, messages and runs; deleting a run
cascades to its steps.

`run_steps.payload` is written through `redact()` in `lib/agent/runs.ts`: keys that look
like secrets become `[redacted]` and long strings are trimmed. `vm_seconds` joins `runs`
in Phase 6, when there is a VM to measure.

## Planned tables

Status: **Proposed**. Columns are a starting point and will change as we build.

### Agents (extend the existing table)

| New column | Type | Why |
|---|---|---|
| `model` | text, nullable | Per-agent model override; null = default in `lib/ai.ts` |
| `runtime` | `shared` \| `vm` | Whether tools run on our server or the agent's own VM |
| `status` | `active` \| `paused` | Pause an agent without deleting it |
| `updated_at` | timestamp | Edits |

### Connections — a user's authorised accounts

| Column | Notes |
|---|---|
| `id` | uuid |
| `user_id` | → users |
| `provider` | `gmail` (built-in) or the id of an allow-listed MCP server, e.g. `mcp:notion` |
| `kind` | `builtin` \| `mcp` |
| `server_url` | for `mcp` connections: the remote MCP server's URL (from our allow-list) |
| `account_label` | e.g. the email address or workspace name, for display |
| `access_token_enc`, `refresh_token_enc` | **Encrypted** (see [security](07-security.md#secrets)) — for both Gmail and MCP server OAuth |
| `scopes` | what the user approved |
| `expires_at`, `status` (`active` / `expired` / `revoked`) | token health |

### MCP server catalog

The allow-list of MCP servers users can connect. Can start as a constant in code (`lib/mcp/servers.ts`) and move to a table later: `id`, `name`, `server_url`, `auth` (OAuth details), `read_only_tools` (tools *we* have reviewed as safe without approval), `enabled`.

### Agent tools — which tools each agent may use

| Column | Notes |
|---|---|
| `agent_id` | → agents |
| `tool` | tool key, e.g. `gmail.search` |
| `connection_id` | → connections (which account this agent uses) |
| `approval` | `never` \| `always` — default `always` for write/send/delete tools |

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

### Approvals

`id`, `run_id`, `step_id`, `summary` (human-readable "Send email to X with subject Y"), `payload` (exact action), `status` (`pending` / `approved` / `rejected` / `expired`), `decided_at`, `expires_at`.

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
