/**
 * The MCP layer's front door. Everything outside `lib/mcp` imports from here.
 *
 * - `servers` — the allow-list: which servers exist, how they authorise, what we reviewed
 *   as read-only (decisions D48, D49).
 * - `oauth` — the connect flow and the per-run bearer token, driven by the official SDK.
 * - `client` — opening a connection to a server and calling it.
 * - `tools` — a server's tools as Omnix tools, and the cache they are read from.
 * - `store` — the registrations and in-flight flows the OAuth layer keeps.
 */
export {
  MCP_SERVERS,
  getMcpServer,
  isMcpServerConfigured,
  isReviewedReadOnly,
  mcpProvider,
  mcpServerId,
  preregisteredClient,
  serverForProvider,
  type McpServerSpec,
} from "./servers";
export {
  McpReauthorizationRequired,
  finishMcpAuthorization,
  mcpRedirectUri,
  revokeMcpTokens,
  startMcpAuthorization,
} from "./oauth";
export { McpCallError, callServerTool, listServerTools } from "./client";
export {
  TOOL_CACHE_TTL_MS,
  cachedMcpTools,
  mcpToolDefinitions,
  mcpToolKey,
  refreshMcpTools,
  toolNameFromKey,
  type CachedTools,
} from "./tools";
export { claimFlow, purgeExpiredFlows, saveFlow, type PendingFlow } from "./store";
