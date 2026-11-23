import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Every timestamp is `withTimezone: true` (Postgres `timestamptz`). A plain `timestamp`
// has no zone, and the driver reads it back in the server's local zone — on a machine in
// India that shifted every time 5.5 hours into the past. `timestamptz` is an exact
// instant, read back correctly wherever the code runs.

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Becomes the agent's system prompt when we connect the AI.
  instructions: text("instructions").notNull().default(""),
  // DiceBear avatar seed, chosen with "Shuffle avatar". Existing rows get a random one.
  avatarSeed: text("avatar_seed")
    .notNull()
    .default(sql`substr(md5(random()::text), 1, 8)`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  // Lease held while the agent is answering in this conversation, so two overlapping
  // messages (e.g. from two tabs) can't both generate from incomplete history. Released
  // when the turn ends; the expiry only matters if a server dies mid-reply.
  busyUntil: timestamp("busy_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A user's authorised accounts — the Gmail inbox an agent may read, and from Phase 5 the
 * MCP servers it may call. One row per connected account, owned by one user (D14).
 *
 * The tokens are encrypted with `lib/crypto.ts` (D13) and bound to this row's owner and
 * provider, so the columns are useless on their own. Nothing here is ever sent to the
 * browser or put in a prompt.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "gmail" for built-in integrations, or an allow-listed server id like "mcp:notion".
    provider: text("provider").notNull(),
    kind: text("kind", { enum: ["builtin", "mcp"] })
      .notNull()
      .default("builtin"),
    // For `mcp` connections: the remote server's URL, from our allow-list.
    serverUrl: text("server_url"),
    // What to show the user: the email address or workspace name.
    accountLabel: text("account_label").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    // Absent when the provider doesn't issue one, so the connection simply expires.
    refreshTokenEnc: text("refresh_token_enc"),
    // What the user actually approved, which is not always what we asked for.
    scopes: text("scopes").array().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status", { enum: ["active", "expired", "revoked"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Reconnecting the same account updates that row instead of adding a duplicate,
    // while a second, different account of the same provider is still allowed.
    uniqueIndex("connections_user_provider_account_idx").on(
      table.userId,
      table.provider,
      table.accountLabel,
    ),
    index("connections_user_idx").on(table.userId),
  ],
);

/**
 * What an agent does on its own: a saved instruction plus when to run it.
 *
 * A task is the agent's own prompt, not a conversation — each run starts from a blank
 * history, so "summarise my inbox" means today's inbox and nothing else. The schedule is
 * a five-field cron read in `timezone`, which is the user's zone and not the server's:
 * "every weekday at 9:00" has to mean 9:00 where they are, through daylight saving.
 *
 * `nextRunAt` is the one thing the scheduler looks at. It is computed whenever the task
 * changes and advanced as each run is claimed, so a task is claimed exactly once per due
 * time even if the minute cron fires twice (see lib/tasks.ts).
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // What the agent is told to do each run, e.g. "Summarise my unread email".
    prompt: text("prompt").notNull(),
    // `event` triggers (new email, a Slack message) arrive in Phase 5.
    trigger: text("trigger", { enum: ["manual", "schedule"] })
      .notNull()
      .default("schedule"),
    // Five-field cron, read in `timezone`. Null for a task only ever run by hand.
    schedule: text("schedule"),
    timezone: text("timezone").notNull().default("UTC"),
    // Where each result goes: "inapp", "email", or both. Empty means nowhere but the run log.
    deliver: text("deliver").array().notNull().default(["inapp"]),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * The next instant the scheduler should fire this task, or null when it never should
     * (disabled, or run by hand only). Always a real instant, computed from the cron and
     * the timezone — the scheduler itself does no cron arithmetic.
     */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The scheduler's only query: enabled tasks whose time has come.
    index("tasks_due_idx").on(table.enabled, table.nextRunAt),
    index("tasks_agent_idx").on(table.agentId),
  ],
);

/**
 * One row per agent run: a chat turn, or a task run started by the schedule or by
 * "Run now". This is the audit log — every tool an agent used is traceable from here,
 * and the Runs tab reads it straight back.
 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Set for chat runs; null for background task runs.
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    // Set for background runs. The run outlives the task: deleting a task leaves its runs
    // in the audit log with a null `task_id` rather than erasing what the agent did.
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    trigger: text("trigger", { enum: ["chat", "manual", "schedule", "event"] }).notNull(),
      status: text("status", {
      enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("running"),
    error: text("error"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    // The Runs tab: one agent's runs, newest first.
    index("runs_agent_started_idx").on(table.agentId, table.startedAt),
    // A task's own history, and the per-user daily cap on background runs.
    index("runs_task_started_idx").on(table.taskId, table.startedAt),
    index("runs_user_started_idx").on(table.userId, table.startedAt),
  ],
);

/**
 * The timeline inside a run: each model turn, tool call and tool result in order.
 * `payload` is redacted of anything that looks like a secret before it is written.
 */
export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type", {
      enum: ["model", "tool_call", "tool_result", "approval", "error"],
    }).notNull(),
    // Tool key for tool steps, e.g. "web.fetch"; null for model steps.
    tool: text("tool"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // The timeline, in order, for one run.
  (table) => [index("run_steps_run_seq_idx").on(table.runId, table.seq)],
);

/**
 * Which tools an agent may use, and with which connected account.
 *
 * A row here records a deliberate choice. With no row, a tool falls back to its default:
 * the ones that need no account (`time.now`, `web.*`) are on for every agent, and anything
 * that reaches a connected account is off until the user turns it on. That is why `enabled`
 * exists as well as the row — switching `web.search` off is a choice too, and absence
 * cannot express it. See `resolveAgentTools()` in lib/tools/selection.ts.
 *
 * `approval` is the user's preference, not the final word: `read` tools never ask and
 * `destructive` tools always do, whatever is stored here (decision D29).
 */
export const agentTools = pgTable(
  "agent_tools",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // Tool key, e.g. "gmail.search".
    tool: text("tool").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // The account this agent uses for this tool. Null for tools that need no connection.
    // Set to null rather than deleted when the account is disconnected, so the tool shows
    // as "needs reconnecting" instead of silently vanishing from the agent's settings.
    connectionId: uuid("connection_id").references(() => connections.id, { onDelete: "set null" }),
    approval: text("approval", { enum: ["never", "always"] })
      .notNull()
      .default("always"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One grant per tool per agent: enabling a tool twice updates the same row.
    primaryKey({ columns: [table.agentId, table.tool] }),
  ],
);

/**
 * An action the agent wants to take that the user must agree to first — the main defence
 * against prompt injection (D10, [security](../docs/07-security.md)).
 *
 * `payload` is the exact, already-validated arguments. When the user approves, *this* is
 * what runs — never a freshly generated call, which an injected instruction could have
 * changed between the card being shown and the click.
 *
 * `resume` is the model conversation the paused turn will continue from, because a chat
 * turn is one HTTP request and cannot sit waiting (decision D35). It holds whatever the
 * tools had read by then, so it is cleared the moment the decision is acted on.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Set for chat approvals, so the card can be shown back in the right conversation.
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    // The `tool_call` step this is waiting on, shown in the run timeline.
    stepId: uuid("step_id").references(() => runSteps.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    // The model's own id for the call, so the result answers the right one on resume.
    toolCallId: text("tool_call_id").notNull(),
    // Plain English: "Send an email to anna@client.com".
    summary: text("summary").notNull(),
    // The real recipient, subject and body as label/value pairs — what the card shows,
    // so the user reads the action itself rather than the agent's description of it.
    details: jsonb("details").notNull().default([]),
    payload: jsonb("payload").notNull().default({}),
    resume: jsonb("resume").notNull().default({}),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired"] })
      .notNull()
      .default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // 24 hours, matching the `waitForEvent` timeout a background run waits on (D41).
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("approvals_user_status_idx").on(table.userId, table.status),
    index("approvals_conversation_idx").on(table.conversationId),
    index("approvals_run_idx").on(table.runId),
  ],
);

/**
 * What the user needs to see from a run they weren't watching: a task's result, a task
 * that failed, or an action a background run is waiting to be allowed to take.
 *
 * In-app delivery is a row here (D42). The body is the agent's own words, so it is
 * rendered as Markdown but never as HTML, and it may contain text an agent read from
 * somewhere else — the same untrusted content rule as a chat reply (docs/07-security.md).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["task_result", "task_failed", "approval_request"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    // Set for `approval_request`, so the card can be drawn and decided from the inbox.
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The inbox, newest first, and the unread count beside it.
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    index("notifications_user_unread_idx").on(table.userId, table.readAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStep = typeof runSteps.$inferSelect;
export type AgentTool = typeof agentTools.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
