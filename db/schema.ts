import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  busyUntil: timestamp("busy_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * One row per agent run: a chat turn today, a task run from Phase 4.
 * This is the audit log — every tool an agent used is traceable from here.
 */
export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Set for chat runs; null for background task runs.
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  // Gains a foreign key to `tasks` in Phase 4, when that table exists.
  taskId: uuid("task_id"),
  trigger: text("trigger", { enum: ["chat", "manual", "schedule", "event"] }).notNull(),
  // `waiting_approval` arrives with approvals in Phase 3.
  status: text("status", {
    enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"],
  })
    .notNull()
    .default("running"),
  error: text("error"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

/**
 * The timeline inside a run: each model turn, tool call and tool result in order.
 * `payload` is redacted of anything that looks like a secret before it is written.
 */
export const runSteps = pgTable("run_steps", {
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStep = typeof runSteps.$inferSelect;
