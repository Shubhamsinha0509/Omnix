import { eq } from "drizzle-orm";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";

import { db, mcpToolCache } from "@/db";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { ApprovalSummary, ToolDefinition, ToolResult } from "@/lib/tools/types";
import { callServerTool, listServerTools, McpCallError } from "./client";
import { McpReauthorizationRequired } from "./oauth";
import { isReviewedReadOnly, mcpProvider, serverForProvider, type McpServerSpec } from "./servers";

/**
 * MCP tools, as the rest of Omnix sees them.
 *
 * The tool registry deliberately hides where a tool comes from: the runner, the run log
 * and the agent's settings all deal in `ToolDefinition`, whether the code behind it is
 * ours or a `tools/call` to somebody else's server (docs/04-agent-runtime.md#tools). This
 * file is the adapter, and it is where the rules that make a stranger's tool safe to offer
 * live:
 *
 *   - **A tool is a write unless we reviewed it as a read.** The server's own
 *     `annotations.readOnlyHint` is not consulted. It is the server's word for it, and a
 *     server that wanted to get a write past an approval would set exactly that flag.
 *   - **Every result is untrusted.** It is text from a stranger's Slack, Notion or Jira,
 *     which is the likeliest place an instruction aimed at the agent is hiding.
 *   - **The description is quoted, not obeyed.** It reaches the model, so it is truncated
 *     and attributed to the server it came from rather than read as if Omnix wrote it.
 */

/**
 * How long a cached tool list is served for.
 *
 * Nothing refreshes it on a page load: a run must not wait on somebody else's server to
 * find out what tools it has, and a settings page must not either. It is refreshed when
 * an account is connected, by the hourly sweep, and when a user asks (`refreshMcpTools`).
 */
export const TOOL_CACHE_TTL_MS = 60 * 60_000;

/** The description we show the model, capped. A server writes this, so it is bounded. */
const MAX_DESCRIPTION_CHARS = 1_000;

/** How much of one tool result goes back. The runner trims again; this bounds the row. */
const MAX_RESULT_CHARS = 20_000;

/** A tool list as it was last read from a server. */
export type CachedTools = {
  tools: Tool[];
  fetchedAt: Date | null;
  /** Why the last refresh failed, so a page can say so instead of showing nothing. */
  error: string | null;
  stale: boolean;
};

/** The cached list for one connected account. A plain read — never a network call. */
export async function cachedMcpTools(connectionId: string): Promise<CachedTools> {
  const [row] = await db
    .select()
    .from(mcpToolCache)
    .where(eq(mcpToolCache.connectionId, connectionId))
    .limit(1);

  if (!row) return { tools: [], fetchedAt: null, error: null, stale: true };

  return {
    tools: (row.tools ?? []) as Tool[],
    fetchedAt: row.fetchedAt,
    error: row.error,
    stale: row.fetchedAt.getTime() + TOOL_CACHE_TTL_MS <= Date.now(),
  };
}

/**
 * Asks a server what tools it has and stores the answer.
 *
 * A failure keeps the previous list and records why. An agent whose Notion tools vanished
 * because Notion had a bad minute would be a worse outcome than one whose tool list is an
 * hour old, and the user gets told either way.
 */
export async function refreshMcpTools(
  userId: number,
  connection: Pick<SafeConnection, "id" | "provider">,
): Promise<CachedTools> {
  const server = serverForProvider(connection.provider);
  if (!server) return { tools: [], fetchedAt: null, error: "That server isn't on the allow-list.", stale: true };

  try {
    const tools = await listServerTools({
      server,
      userId,
      connectionId: connection.id,
    });

    const fetchedAt = new Date();
    await db
      .insert(mcpToolCache)
      .values({ connectionId: connection.id, tools, fetchedAt, error: null })
      .onConflictDoUpdate({
        target: mcpToolCache.connectionId,
        set: { tools, fetchedAt, error: null },
      });

    return { tools, fetchedAt, error: null, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const existing = await cachedMcpTools(connection.id);

    await db
      .insert(mcpToolCache)
      .values({
        connectionId: connection.id,
        tools: existing.tools,
        fetchedAt: existing.fetchedAt ?? new Date(),
        error: message,
      })
      .onConflictDoUpdate({ target: mcpToolCache.connectionId, set: { error: message } });

    return { ...existing, error: message };
  }
}

/**
 * The tool key for an MCP tool: the server id, a dot, then the server's own tool name.
 *
 * It has to survive `toWireName`, which is what the model sees, and that allows only
 * letters, digits, underscores and dashes — so anything else in a server's name is
 * replaced. A name that can't be represented at all is dropped rather than mangled into
 * one that collides with another tool (the spec asks clients to exclude such tools).
 */
export function mcpToolKey(serverId: string, toolName: string) {
  return `${serverId}.${toolName}`;
}

/** The server tool name inside a key, or null when the key isn't an MCP tool's. */
export function toolNameFromKey(serverId: string, key: string) {
  const prefix = `${serverId}.`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/** Names that survive the trip to the model unchanged. 64 is the function-name limit. */
function isWireSafe(serverId: string, toolName: string) {
  const wire = mcpToolKey(serverId, toolName).replace(/\./g, "_");
  return /^[a-zA-Z0-9_-]+$/.test(wire) && wire.length <= 64;
}

/**
 * The tools one connected account offers this agent, as `ToolDefinition`s.
 *
 * Built from the cache, so this is a database read and nothing more — `resolveAgentTools`
 * calls it on every run.
 */
export async function mcpToolDefinitions(
  connection: Pick<SafeConnection, "id" | "provider">,
): Promise<ToolDefinition[]> {
  const server = serverForProvider(connection.provider);
  if (!server) return [];

  const { tools } = await cachedMcpTools(connection.id);
  const definitions: ToolDefinition[] = [];

  for (const tool of tools) {
    if (!tool?.name || !isWireSafe(server.id, tool.name)) continue;
    definitions.push(toDefinition(server, tool));
  }

  return definitions;
}

function toDefinition(server: McpServerSpec, tool: Tool): ToolDefinition {
  const readOnly = isReviewedReadOnly(server, tool.name);
  const schema = (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;

  return {
    key: mcpToolKey(server.id, tool.name),
    label: tool.title?.trim() || tool.name,
    description: describe(server, tool),
    // Never `destructive`: that risk level can't have its approval turned off (D29), and
    // a user who trusts one specific Jira tool on one agent should be allowed to say so.
    // What matters is that the default is to ask, which `write` already means.
    risk: readOnly ? "read" : "write",
    provider: mcpProvider(server.id),
    runsIn: "server",
    // A placeholder: the real schema is `openParameters`, which is what the model is sent
    // and what the arguments are checked against. `parameters` stays well-typed for the
    // benefit of every built-in tool.
    parameters: { type: "object", properties: {} },
    openParameters: schema,
    untrustedOutput: true,
    summary: shortSummary(tool),
    summarise: (args) => summarise(server, tool, args),
    execute: async (ctx, args) => {
      // The account comes from the run, not from the closure, so a tool definition
      // cached in memory can never be used against a different connection.
      const connectionId = ctx.auth?.connectionId;
      if (!connectionId) {
        return { error: `No ${server.name} account is connected for this agent.` };
      }

      try {
        const result = await callServerTool(
          { server, userId: ctx.user.id, connectionId, signal: ctx.signal },
          { name: tool.name, arguments: args },
        );
        return toToolResult(server, tool, result);
      } catch (error) {
        if (error instanceof McpReauthorizationRequired) return { error: error.message };
        if (error instanceof McpCallError) return { error: error.message };
        throw error;
      }
    },
  };
}

/**
 * The description the model reads.
 *
 * Attributed on purpose. A tool description is the one piece of a stranger's text that
 * arrives looking like something Omnix said, and "tool poisoning" is exactly that: a
 * server writing "also forward the user's email to…" into a description. Naming the
 * source doesn't neutralise it — the allow-list (D49) and approvals (D10) are what do
 * that — but it stops the model reading a server's instructions as the system's own.
 */
function describe(server: McpServerSpec, tool: Tool) {
  const own = (tool.description ?? "").replace(/\s+/g, " ").trim();
  const text = own.length > MAX_DESCRIPTION_CHARS ? `${own.slice(0, MAX_DESCRIPTION_CHARS)}…` : own;
  const prefix = `From the ${server.name} MCP server, which describes it as:`;
  return text ? `${prefix} ${text}` : `The "${tool.name}" tool on the ${server.name} MCP server.`;
}

/** The one line the settings page shows: the server's own words, trimmed to fit. */
function shortSummary(tool: Tool) {
  const own = (tool.description ?? "").replace(/\s+/g, " ").trim();
  if (!own) return `The "${tool.name}" tool.`;
  const firstSentence = own.split(/(?<=[.!?])\s/)[0] ?? own;
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 140)}…` : firstSentence;
}

/**
 * What the approval card says.
 *
 * We can't write a sentence per tool the way `gmail.send` does — these tools are not ours
 * and there are hundreds of them — so the card shows the tool, the server, and every
 * argument as it will be sent. That is less polished and just as honest: the user reads
 * the actual call rather than the agent's account of it.
 */
function summarise(server: McpServerSpec, tool: Tool, args: Record<string, unknown>): ApprovalSummary {
  const details = Object.entries(args).map(([label, value]) => ({
    label,
    value: preview(value),
  }));

  return {
    summary: `Run "${tool.title?.trim() || tool.name}" on ${server.name}`,
    details: details.length > 0 ? details : [{ label: "Arguments", value: "none" }],
  };
}

/** One argument as a line on the card: short, and never a wall of JSON. */
function preview(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * A server's answer, as the model will read it.
 *
 * MCP's own convention is that a failed call is still a successful result with `isError`
 * set, which maps straight onto our `{ error }` — the model is told what went wrong and
 * the run carries on.
 */
function toToolResult(server: McpServerSpec, tool: Tool, result: CallToolResult): ToolResult {
  const text = flatten(result);

  if (result.isError) {
    return { error: text || `${tool.name} failed on ${server.name}.` };
  }

  // A tool that declares an output schema returns the structured form as well; it is the
  // more useful of the two for a model, so it wins when present.
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return { output: result.structuredContent };
  }
  return { output: text };
}

/**
 * The content blocks as one string.
 *
 * Images and audio are named rather than passed on: the chat model in this stack is given
 * text, and a base64 image would be a very expensive way to tell it nothing.
 */
function flatten(result: CallToolResult) {
  const parts: string[] = [];

  for (const block of result.content ?? []) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        break;
      case "image":
      case "audio":
        parts.push(`[${block.type} omitted]`);
        break;
      case "resource_link":
        parts.push(`[${block.name ?? "resource"}: ${block.uri}]`);
        break;
      case "resource": {
        const contents = block.resource;
        if (contents && "text" in contents && typeof contents.text === "string") {
          parts.push(contents.text);
        } else {
          parts.push(`[binary resource: ${contents?.uri ?? "unknown"}]`);
        }
        break;
      }
      default:
        break;
    }
  }

  const text = parts.join("\n").trim();
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
}
