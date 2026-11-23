import type { Agent, User } from "@/db";
import type { ToolAuth } from "@/lib/integrations/access";

/**
 * The subset of JSON Schema a tool may use for its parameters. It travels to the model
 * as a function tool's `parameters`, and `validateArgs` checks the arguments that come
 * back against it before the tool runs.
 */
export type JsonSchema = {
  type: "object";
  properties: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: false;
};

export type PropertySchema = {
  type: "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: string[];
  /** For `array`: the type of each item. */
  items?: PropertySchema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
};

/**
 * How much damage a tool can do, and with it whether the user is asked first:
 * `read` never asks, `write` asks unless the user has trusted that tool on that agent,
 * and `destructive` always asks whatever the setting says (decision D29).
 */
export type ToolRisk = "read" | "write" | "destructive";

/** What an approval card says. The values are the real ones, not the agent's account of them. */
export type ApprovalSummary = {
  /** One line, in plain English: "Send an email to anna@client.com". */
  summary: string;
  /** The action itself, field by field — recipient, subject, body. */
  details?: { label: string; value: string }[];
};

/** Everything a tool is allowed to know about the run it's part of. */
export type ToolContext = {
  user: User;
  agent: Agent;
  runId: string;
  /** IANA timezone the user is in, e.g. "Asia/Kolkata". "UTC" when unknown. */
  timezone: string;
  /** Aborted when the user stops the reply or the run is cancelled. */
  signal: AbortSignal;
  /**
   * The connected account this call is bound to, for tools with a `provider`.
   *
   * Tokens are decrypted inside it at the moment a request is made and never reach the
   * model (docs/07-security.md#secrets). Null for tools that need no account.
   */
  auth: ToolAuth | null;
};

/** What a tool hands back to the model. `error` means the call failed but the run continues. */
export type ToolResult = { output: unknown } | { error: string };

/**
 * A tool the agent can call. Defined once here and used by every trigger (chat, task).
 * Native tools are the exception: the provider runs them itself, so they have no `execute`.
 */
export type ToolDefinition = {
  /** Stable key, e.g. "web.fetch". Also what `agent_tools` will store in Phase 3. */
  key: string;
  /** Shown in the chat while the tool runs, e.g. "Reading the page". */
  label: string;
  /** Written for the model: what it does and when to use it. */
  description: string;
  risk: ToolRisk;
  /**
   * One line for the user, where `description` (written for the model) reads badly as UI.
   * Built-in tools get theirs from `TOOL_SUMMARIES`; an MCP tool brings its own, because
   * there are hundreds of them and none is ours to write.
   */
  summary?: string;
  /** Needs a connection of this type (Phase 3), e.g. "gmail". */
  provider?: string;
  /** Where the tool's code runs. `sandbox` tools need the agent's VM (Phase 6). */
  runsIn: "server" | "sandbox";
  parameters: JsonSchema;
  /**
   * The parameter schema exactly as its source published it, for tools whose schema is
   * not ours to write — an MCP server's (Phase 5).
   *
   * When present this is what the model is shown, and the arguments it writes are checked
   * loosely rather than against `parameters`. Both halves matter: a server's schema can
   * use nested objects and unions that `JsonSchema` can't express, and `validateArgs`
   * *drops* properties it doesn't recognise — so squeezing one into the subset would mean
   * quietly sending a remote server a call with arguments missing.
   */
  openParameters?: Record<string, unknown>;
  /**
   * True when the result contains text written by strangers (web pages, emails).
   * The runner labels it as untrusted data so the model doesn't follow instructions in it.
   */
  untrustedOutput?: boolean;
  /**
   * Describes exactly what a call would do, for the approval card. Every tool that can
   * need approval has one: a card reading "the agent wants to use gmail.send" tells the
   * user nothing they can actually judge.
   */
  summarise?(args: Record<string, unknown>): ApprovalSummary;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
};

/**
 * A tool OpenRouter executes on its own side, mid-request (a server tool). There is
 * nothing for us to run, so we only declare it and log what it did — we learn that from
 * the citations and usage the response carries back. See decision D27.
 */
export type NativeToolDefinition = {
  key: string;
  label: string;
  risk: ToolRisk;
  /** The server tool's type, which is the whole declaration OpenRouter needs. */
  native: "openrouter:web_search";
};

export type AnyTool = ToolDefinition | NativeToolDefinition;

export function isNativeTool(tool: AnyTool): tool is NativeToolDefinition {
  return "native" in tool;
}
