import type { Agent, User } from "@/db";

/**
 * The subset of JSON Schema a tool may use for its parameters. Gemini receives this
 * as `parametersJsonSchema`, and `validateArgs` checks the model's arguments against it
 * before the tool runs.
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

/** How much damage a tool can do. Drives the approval rules (Phase 3). */
export type ToolRisk = "read" | "write" | "destructive";

/** Everything a tool is allowed to know about the run it's part of. */
export type ToolContext = {
  user: User;
  agent: Agent;
  runId: string;
  /** IANA timezone the user is in, e.g. "Asia/Kolkata". "UTC" when unknown. */
  timezone: string;
  /** Aborted when the user stops the reply or the run is cancelled. */
  signal: AbortSignal;
};

/** What a tool hands back to the model. `error` means the call failed but the run continues. */
export type ToolResult = { output: unknown } | { error: string };

/**
 * A tool the agent can call. Defined once here and used by every trigger (chat, task).
 * Native tools are the exception: Gemini runs them itself, so they have no `execute`.
 */
export type ToolDefinition = {
  /** Stable key, e.g. "web.fetch". Also what `agent_tools` will store in Phase 3. */
  key: string;
  /** Shown in the chat while the tool runs, e.g. "Reading the page". */
  label: string;
  /** Written for the model: what it does and when to use it. */
  description: string;
  risk: ToolRisk;
  /** Needs a connection of this type (Phase 3), e.g. "gmail". */
  provider?: string;
  /** Where the tool's code runs. `sandbox` tools need the agent's VM (Phase 6). */
  runsIn: "server" | "sandbox";
  parameters: JsonSchema;
  /**
   * True when the result contains text written by strangers (web pages, emails).
   * The runner labels it as untrusted data so the model doesn't follow instructions in it.
   */
  untrustedOutput?: boolean;
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
