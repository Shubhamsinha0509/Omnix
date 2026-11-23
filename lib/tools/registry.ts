import { GMAIL_TOOLS } from "./gmail";
import { SANDBOX_TOOLS } from "./sandbox";
import { timeNow } from "./time";
import { webFetch, webSearch } from "./web";
import { isNativeTool, type AnyTool, type ToolDefinition } from "./types";

/**
 * Every tool Omnix knows about, by key. Adding a tool means adding it here and nowhere
 * else: the runner, the logs and the agent's tool settings all read this one map.
 *
 * The order is the order the settings page lists them in, so related tools stay together.
 */
export const TOOLS: Record<string, AnyTool> = {
  [timeNow.key]: timeNow,
  [webSearch.key]: webSearch,
  [webFetch.key]: webFetch,
  ...Object.fromEntries(GMAIL_TOOLS.map((tool) => [tool.key, tool])),
  // The agent's own VM (Phase 6). Offered only when E2B is configured (selection.ts).
  ...Object.fromEntries(SANDBOX_TOOLS.map((tool) => [tool.key, tool])),
};

/**
 * Tool names allow letters, digits, underscores and dashes but not dots, so "web.fetch"
 * travels as "web_fetch". Everything user-facing and everything logged uses the key.
 */
export function toWireName(key: string) {
  return key.replace(/\./g, "_");
}

/**
 * A tool entry in an OpenRouter request. Ours are ordinary OpenAI function tools; a
 * server tool is named by its type alone and OpenRouter runs it mid-request. The OpenAI
 * SDK's own tool union doesn't know about server tools, which is why this type exists.
 */
export type ModelTool =
  | { type: "function"; function: { name: string; description: string; parameters: object } }
  | { type: string };

/** Builds the `tools` array for a request: OpenRouter's server tools plus our functions. */
export function buildModelTools(tools: AnyTool[]): ModelTool[] {
  const result: ModelTool[] = [];

  for (const tool of tools) {
    if (isNativeTool(tool)) {
      result.push({ type: tool.native });
      continue;
    }
    result.push({
      type: "function",
      function: {
        name: toWireName(tool.key),
        description: tool.description,
        // An MCP tool's schema is its server's to define, and is passed on untouched.
        parameters: tool.openParameters ?? tool.parameters,
      },
    });
  }

  return result;
}

/** Maps a function name the model sent back to the tool it belongs to. */
export function resolveWireName(tools: AnyTool[], wireName: string): ToolDefinition | undefined {
  return tools.find(
    (tool): tool is ToolDefinition => !isNativeTool(tool) && toWireName(tool.key) === wireName,
  );
}
