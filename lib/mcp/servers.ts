/**
 * The MCP servers Omnix will talk to — and nothing else (decision D49).
 *
 * A tool's description is instructions the model reads and acts on, so an arbitrary
 * server is an arbitrary prompt injection with a credential attached. This file is the
 * trust boundary: every server here was looked at by a person, and the `readOnlyTools`
 * list is the record of which of its tools we are willing to let an agent run without
 * asking the user first.
 *
 * The URLs, registration modes and scopes come from the Phase 5 spike
 * (docs/05-integrations.md#the-phase-5-spike-22-november-2026).
 */

/**
 * How we get a `client_id` for a server's authorization server (decision D48).
 *
 * `dynamic` servers register us on first use and need no configuration at all;
 * `preregistered` servers need an app someone created by hand, with its credentials in
 * the environment — which also means they can be switched off by not setting them.
 */
export type McpRegistration =
  | { mode: "dynamic" }
  | { mode: "preregistered"; clientIdEnv: string; clientSecretEnv: string };

export type McpServerSpec = {
  /** Short id used in URLs and as the connection provider (`mcp:notion`). */
  id: string;
  /** What the user sees: "Notion". */
  name: string;
  /** The MCP endpoint. Also the RFC 8707 resource the token is bound to. */
  url: string;
  registration: McpRegistration;
  /**
   * The scopes we ask for, narrowest set that covers what agents do here.
   *
   * Not optional on purpose. Left unset, the SDK falls back to the server's whole
   * `scopes_supported` list — which for Atlassian is about forty scopes including
   * `delete:jira` and `write:talent`, and for Slack is all thirty. Asking for everything
   * a server offers is the opposite of least privilege, so each entry states its own.
   */
  scopes: string[];
  /**
   * Tools reviewed by us as read-only, which therefore never ask for approval.
   *
   * Everything else a server offers is treated as a write and asks every time — a server
   * telling us a tool is harmless (`annotations.readOnlyHint`) is the server's word for
   * it, and the whole point of the list is that it isn't taken.
   */
  readOnlyTools: string[];
  /** One line for the integrations page. */
  summary: string;
  /** Where a curious user can read what the server does. */
  docsUrl: string;
  /** Shown in the UI: the server itself says it is not finished. */
  beta?: boolean;
  /** Why this server can't be connected yet, when that is a fact about the server. */
  caveat?: string;
};

export const MCP_SERVERS: McpServerSpec[] = [
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    registration: { mode: "dynamic" },
    // Notion has exactly one scope, so there is nothing to narrow: what an agent can
    // reach is decided on Notion's side, by which pages the user shares during consent.
    scopes: ["default"],
    // Names published by Notion (developers.notion.com/guides/mcp/tools-faqs). Searching
    // and fetching are reads in the plainest sense; everything that creates, moves,
    // deletes, comments or uploads is left off and asks.
    readOnlyTools: [
      "notion-search",
      "notion-ai-search",
      "notion-connector-search",
      "notion-memory-search",
      "notion-fetch",
      "notion-get-comments",
      "notion-get-self",
      "notion-get-users",
      "notion-get-teams",
      "notion-get-groups",
      "notion-get-version-changes",
      "notion-get-suggested-edit",
      "notion-list-page-backlinks",
      "notion-list-recent-pages",
      "notion-list-favorite-pages",
      "notion-list-shared-pages",
      "notion-list-private-pages",
      "notion-query-data-sources",
      "notion-query-multiple-data-sources",
      "notion-query-meeting-notes",
    ],
    summary: "Search your workspace, read pages, and draft new ones.",
    docsUrl: "https://developers.notion.com/guides/mcp/overview",
    beta: true,
  },
  {
    id: "jira",
    name: "Jira",
    url: "https://mcp.atlassian.com/v2/mcp",
    registration: { mode: "dynamic" },
    // Atlassian's server covers Confluence, Bitbucket, Loom, goals, talent and more. We
    // ask for Jira and Confluence, read, write and search — not delete, not manage, and
    // nothing for the products an Omnix agent has no tools for.
    scopes: [
      "read:me",
      "offline_access",
      "read:jira:agent-interface",
      "write:jira:agent-interface",
      "search:jira:agent-interface",
      "read:confluence:agent-interface",
      "search:confluence:agent-interface",
    ],
    // Names published by Atlassian (developer.atlassian.com/cloud/rovo-mcp). `discover`
    // and `executeRead` are its own read paths; `executeWrite` and `executeDestructive`
    // are deliberately absent, and so is every `create*`, `edit*`, `add*` and `delete*`.
    readOnlyTools: [
      "atlassianUserInfo",
      "getAccessibleAtlassianResources",
      "discover",
      "executeRead",
      "getJiraIssue",
      "getJiraCurrentUser",
      "getJiraUser",
      "searchJiraIssuesUsingJql",
      "listJiraProjects",
      "listJiraIssueComments",
      "listJiraIssueTransitions",
      "listJiraIssueChangelogs",
      "listJiraIssueWorklogs",
      "listJiraStatuses",
      "listJiraBoards",
      "listJiraBoardSprints",
      "listJiraFilters",
      "listJiraDashboards",
      "lookupJiraAccountId",
      "searchConfluence",
      "getConfluenceContent",
      "listConfluenceContent",
      "listConfluenceSpaces",
      "getConfluenceSpace",
      "getConfluenceComment",
      "listConfluenceComments",
    ],
    summary: "Read and search work items, and comment on them.",
    docsUrl: "https://www.atlassian.com/platform/remote-mcp-server",
  },
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    // Slack publishes no `registration_endpoint` and allows only a Marketplace-published
    // or workspace-internal app to use MCP at all, so there is nothing to register
    // dynamically — the credentials have to come from an app someone made (D48).
    registration: {
      mode: "preregistered",
      clientIdEnv: "SLACK_CLIENT_ID",
      clientSecretEnv: "SLACK_CLIENT_SECRET",
    },
    // Enough to read the channels a user is in and post as them. No `files:write`, no
    // `canvases:*`, no `lists:*`, no `channels:write` — an agent that can create channels
    // is a bigger blast radius than anything Phase 5 needs.
    scopes: [
      "channels:history",
      "channels:read",
      "groups:history",
      "groups:read",
      "im:history",
      "im:read",
      "mpim:history",
      "mpim:read",
      "search:read.public",
      "users:read",
      "reactions:read",
      "chat:write",
    ],
    // Empty on purpose. Slack documents its tools by capability ("Read a channel") and
    // not by the name they go by on the wire, so there is nothing here that has actually
    // been reviewed — and a guessed name in this list would be a guess that skips an
    // approval. Fill it in from a real `tools/list` once a workspace is connected; until
    // then every Slack tool asks, which is the safe way round to be wrong.
    readOnlyTools: [],
    summary: "Search and read channels, and post messages as you.",
    docsUrl: "https://docs.slack.dev/ai/slack-mcp-server/",
    caveat:
      "Slack only allows apps published in its Marketplace, or a workspace's own internal app, " +
      "to use MCP — and a workspace admin has to approve it.",
  },
];

/** The `connections.provider` value for a server, e.g. `mcp:notion`. */
export function mcpProvider(serverId: string) {
  return `mcp:${serverId}`;
}

/** The server id inside a provider value, or null when it isn't an MCP connection. */
export function mcpServerId(provider: string) {
  return provider.startsWith("mcp:") ? provider.slice(4) : null;
}

/** An allow-listed server by id. Anything not here cannot be connected or called. */
export function getMcpServer(serverId: string | null | undefined) {
  if (!serverId) return undefined;
  return MCP_SERVERS.find((server) => server.id === serverId);
}

/** The allow-listed server a connection's provider names. */
export function serverForProvider(provider: string) {
  return getMcpServer(mcpServerId(provider));
}

/**
 * The OAuth client credentials for a `preregistered` server, or null when the
 * environment hasn't got them — which is how Slack reads as "not configured" in the UI
 * rather than sending a user to a consent screen that will refuse them.
 */
export function preregisteredClient(server: McpServerSpec) {
  if (server.registration.mode !== "preregistered") return null;

  const clientId = process.env[server.registration.clientIdEnv]?.trim();
  const clientSecret = process.env[server.registration.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret };
}

/** True when this server could be connected right now. */
export function isMcpServerConfigured(server: McpServerSpec) {
  return server.registration.mode === "dynamic" || preregisteredClient(server) !== null;
}

/** Whether a tool on a server has been reviewed as read-only (decision D10, D49). */
export function isReviewedReadOnly(server: McpServerSpec, toolName: string) {
  return server.readOnlyTools.includes(toolName);
}
