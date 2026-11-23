import { and, eq } from "drizzle-orm";

import { agentTools, connections, db, type Agent } from "@/db";
import { mcpToolDefinitions } from "@/lib/mcp/tools";
import { serverForProvider } from "@/lib/mcp/servers";
import { TOOLS } from "./registry";
import { isNativeTool, type AnyTool, type ToolRisk } from "./types";

/**
 * Which tools an agent may actually use on a given run, and with which account.
 *
 * The rules are in one place because getting them wrong is a security bug rather than a
 * bug: a tool reaching the wrong person's mailbox, or a send going out without the user
 * ever being asked. See docs/04-agent-runtime.md#tools and decision D29.
 */

export type ResolvedTool = {
  tool: AnyTool;
  /** The account this tool will use, or null when it needs none. */
  connectionId: string | null;
  /** The final rule after the risk floor is applied — not necessarily what is stored. */
  approval: "never" | "always";
};

/**
 * A tool with no `provider` and `risk: "read"` is on unless the user turned it off; that
 * was the Phase 2 behaviour and existing agents keep it. Everything else — anything that
 * reaches a connected account, writes, or sends — starts off.
 */
function defaultEnabled(tool: AnyTool) {
  return !("provider" in tool && tool.provider) && tool.risk === "read";
}

/**
 * The risk floor. A user may choose to trust a `write` tool on one agent, but `read`
 * never asks and `destructive` always does, whatever is stored (D29).
 */
function effectiveApproval(risk: ToolRisk, stored: "never" | "always" | undefined) {
  if (risk === "read") return "never" as const;
  if (risk === "destructive") return "always" as const;
  return stored ?? "always";
}

type Grant = {
  enabled: boolean;
  connectionId: string | null;
  approval: "never" | "always";
  /** The provider of the connection the row points at, so a mismatch can be ignored. */
  connectionProvider: string | null;
  connectionActive: boolean;
};

/** Every grant this agent has, joined to the connection each one names. */
async function loadGrants(agentId: string) {
  const rows = await db
    .select({
      tool: agentTools.tool,
      enabled: agentTools.enabled,
      connectionId: agentTools.connectionId,
      approval: agentTools.approval,
      connectionProvider: connections.provider,
      connectionStatus: connections.status,
    })
    .from(agentTools)
    .leftJoin(connections, eq(agentTools.connectionId, connections.id))
    .where(eq(agentTools.agentId, agentId));

  return new Map<string, Grant>(
    rows.map((row) => [
      row.tool,
      {
        enabled: row.enabled,
        connectionId: row.connectionId,
        approval: row.approval,
        connectionProvider: row.connectionProvider ?? null,
        connectionActive: row.connectionStatus === "active",
      },
    ]),
  );
}

/**
 * The active connection to fall back on when a grant names none.
 *
 * A user with one Gmail account shouldn't have to pick it from a list of one, so enabling
 * the tool is enough. The lookup is still scoped to the owner, and a grant that names a
 * specific account always wins over this.
 */
async function defaultConnections(userId: number) {
  const rows = await db
    .select({ id: connections.id, provider: connections.provider })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.status, "active")))
    .orderBy(connections.createdAt);

  const byProvider = new Map<string, string>();
  for (const row of rows) if (!byProvider.has(row.provider)) byProvider.set(row.provider, row.id);
  return byProvider;
}

/**
 * Every tool this user has: the built-in ones, plus whatever their connected MCP servers
 * are currently offering (Phase 5).
 *
 * Built-in tools are a constant; MCP tools are not — they belong to a user's accounts and
 * are whatever each server last said it had. That is why this is a function of the user
 * rather than a module-level map, and why it reads the tool cache instead of the network:
 * `resolveAgentTools` runs before every single agent turn (`lib/mcp/tools.ts`).
 */
async function toolsForUser(userId: number): Promise<AnyTool[]> {
  const rows = await db
    .select({ id: connections.id, provider: connections.provider, kind: connections.kind })
    .from(connections)
    .where(and(eq(connections.userId, userId), eq(connections.status, "active")))
    .orderBy(connections.createdAt);

  const mcpConnections = rows.filter(
    // An allow-list check, not just a column check: a row naming a server we have since
    // removed from `MCP_SERVERS` offers no tools at all (D49).
    (row) => row.kind === "mcp" && serverForProvider(row.provider) !== undefined,
  );

  const perConnection = await Promise.all(
    mcpConnections.map((row) => mcpToolDefinitions({ id: row.id, provider: row.provider })),
  );

  return [...Object.values(TOOLS), ...perConnection.flat()];
}

/**
 * The tools to offer the model for this run.
 *
 * A tool that needs an account it hasn't got is left out entirely rather than offered and
 * failed: a model told it can read email, which then can't, wastes a turn apologising.
 */
export async function resolveAgentTools(agent: Agent): Promise<ResolvedTool[]> {
  const [grants, fallbacks, tools] = await Promise.all([
    loadGrants(agent.id),
    defaultConnections(agent.userId),
    toolsForUser(agent.userId),
  ]);
  const resolved: ResolvedTool[] = [];

  for (const tool of tools) {
    const grant = grants.get(tool.key);
    if (!(grant ? grant.enabled : defaultEnabled(tool))) continue;

    const provider = isNativeTool(tool) ? undefined : tool.provider;
    let connectionId: string | null = null;

    if (provider) {
      // A grant pointing at a disconnected or foreign account is treated as no grant.
      const named =
        grant?.connectionId && grant.connectionActive && grant.connectionProvider === provider
          ? grant.connectionId
          : null;
      connectionId = named ?? fallbacks.get(provider) ?? null;
      if (!connectionId) continue;
    }

    resolved.push({
      tool,
      connectionId,
      approval: effectiveApproval(tool.risk, grant?.approval),
    });
  }

  return resolved;
}

/** One tool as the agent's settings page shows it. */
export type ToolSetting = {
  key: string;
  label: string;
  /** A short line for the user, not the model's long description. */
  summary: string;
  risk: ToolRisk;
  provider: string | null;
  /**
   * The provider's name for the UI: "Gmail", "Notion". The settings page groups by
   * provider and an MCP provider is `mcp:notion`, which is not a heading anyone wants to
   * read — and the page is a client component, so it can't look the server up itself.
   */
  providerName: string | null;
  enabled: boolean;
  /** The chosen account, or null for "use my connected account". */
  connectionId: string | null;
  approval: "never" | "always";
  /** False for `read` and `destructive` tools, whose approval rule is fixed (D29). */
  approvalEditable: boolean;
  /** True when the tool needs an account the user hasn't connected. */
  needsConnection: boolean;
};

/**
 * Every tool Omnix has, with this agent's current choice for each — including the ones
 * that can't be used yet, so the page can say *why* rather than just omitting them.
 */
export async function listToolSettings(agent: Agent): Promise<ToolSetting[]> {
  const [grants, fallbacks, tools] = await Promise.all([
    loadGrants(agent.id),
    defaultConnections(agent.userId),
    toolsForUser(agent.userId),
  ]);

  return tools.map((tool) => {
    const grant = grants.get(tool.key);
    const provider = (isNativeTool(tool) ? undefined : tool.provider) ?? null;
    const chosen =
      grant?.connectionId && grant.connectionProvider === provider ? grant.connectionId : null;
    const hasAccount = !provider || Boolean(chosen) || fallbacks.has(provider);

    return {
      key: tool.key,
      label: tool.label,
      summary: ("summary" in tool && tool.summary) || TOOL_SUMMARIES[tool.key] || tool.label,
      risk: tool.risk,
      provider,
      providerName: providerName(provider),
      enabled: grant ? grant.enabled : defaultEnabled(tool),
      connectionId: chosen,
      approval: effectiveApproval(tool.risk, grant?.approval),
      approvalEditable: tool.risk === "write",
      needsConnection: Boolean(provider) && !hasAccount,
    };
  });
}

/** What to call a provider in the UI. */
function providerName(provider: string | null) {
  if (!provider) return null;
  return serverForProvider(provider)?.name ?? (provider === "gmail" ? "Gmail" : provider);
}

/**
 * One line per tool for the settings page. The `description` field is written for the
 * model — long, full of instructions about when to call it — and reads badly as UI.
 */
const TOOL_SUMMARIES: Record<string, string> = {
  "time.now": "Look up the current date and time in your timezone.",
  "web.search": "Search the web. Billed per search on top of tokens.",
  "web.fetch": "Read a public web page or JSON API by URL.",
  "gmail.search": "Find messages in your mailbox.",
  "gmail.read": "Read one message in full, including attachment names.",
  "gmail.create_draft": "Save a draft in your Drafts folder. Nothing is sent.",
  "gmail.send": "Send an email from your account. This can't be taken back.",
};
