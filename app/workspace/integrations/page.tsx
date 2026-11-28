import { notFound } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { HeroWash, PageWrap } from "@/components/custom/design/HeroWash";
import Connections, { type IntegrationView } from "@/components/custom/workspace/Connections";
import { TOOLS } from "@/lib/tools";
import { getCurrentUser } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";
import { listConnections } from "@/lib/integrations/connections";
import { hasGoogleOAuth } from "@/lib/integrations/google";
import { MCP_SERVERS, cachedMcpTools, isMcpServerConfigured, mcpProvider } from "@/lib/mcp";
import { MOCK_INTEGRATIONS } from "@/lib/mock-data";
import { devOnly } from "@/lib/setup";

type Props = {
  /** The connect flow redirects back here with its result in the query string. */
  searchParams: Promise<{
    connected?: string;
    error?: string;
    partial?: string;
    warning?: string;
    tools?: string;
  }>;
};

/**
 * The letter mark and colour each app is drawn with. Here rather than in
 * `lib/mcp/servers.ts`, which is a trust boundary and has no business knowing about
 * brand colours.
 */
const BRAND: Record<string, { mark: string; color: string }> = {
  gmail: { mark: "G", color: "#EA4335" },
  slack: { mark: "S", color: "#611F69" },
  notion: { mark: "N", color: "#37352F" },
  jira: { mark: "J", color: "#0052CC" },
};

/** Integrations (design/reference/15-integrations.html). */
export default async function IntegrationsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const [connections, result] = await Promise.all([listConnections(user.id), searchParams]);

  // How many tools each built-in provider gives agents, for the tiles ("4 tools").
  const builtinToolCounts: Record<string, number> = {};
  for (const tool of Object.values(TOOLS)) {
    if ("provider" in tool && tool.provider) {
      builtinToolCounts[tool.provider] = (builtinToolCounts[tool.provider] ?? 0) + 1;
    }
  }

  const pick = (provider: string) => {
    const matching = connections.filter((connection) => connection.provider === provider);
    const active = matching.find((connection) => connection.status === "active") ?? null;
    return { active, broken: active ? null : (matching[0] ?? null) };
  };

  const encryptionReady = hasEncryptionKey();
  const gmail = pick("gmail");

  const gmailView: IntegrationView = {
    key: "gmail",
    name: "Gmail",
    description: "Search, read and draft email. Sending needs your OK.",
    ...BRAND.gmail,
    connection: gmail.active,
    broken: gmail.broken,
    toolCount: builtinToolCounts.gmail ?? 0,
    connectHref:
      hasGoogleOAuth() && encryptionReady
        ? "/api/connections/gmail/start?returnTo=/workspace/integrations"
        : null,
    disabledReason: !hasGoogleOAuth()
      ? devOnly("Google OAuth isn't configured in .env.", "Not available on this server yet.")
      : null,
  };

  // Each connected MCP server reports its own tools, so the count comes from the cache
  // rather than from anything we wrote down (lib/mcp/tools.ts).
  const mcpViews: IntegrationView[] = await Promise.all(
    MCP_SERVERS.map(async (server) => {
      const { active, broken } = pick(mcpProvider(server.id));
      const configured = isMcpServerConfigured(server);
      const cached = active ? await cachedMcpTools(active.id) : null;

      return {
        key: server.id,
        name: server.name,
        description: server.summary,
        ...(BRAND[server.id] ?? { mark: server.name.slice(0, 1), color: "#4B5563" }),
        connection: active,
        broken,
        toolCount: cached?.tools.length ?? 0,
        connectHref:
          configured && encryptionReady
            ? `/api/connections/mcp/${server.id}/start?returnTo=/workspace/integrations`
            : null,
        disabledReason: configured ? null : (server.caveat ?? "Not configured on this server."),
        beta: server.beta,
        docsUrl: server.docsUrl,
        toolsState: cached
          ? { fetchedAt: cached.fetchedAt?.toISOString() ?? null, error: cached.error, stale: cached.stale }
          : null,
      } satisfies IntegrationView;
    }),
  );

  // Whatever is left is still a picture of an app we haven't built (lib/mock-data.ts).
  const mockViews: IntegrationView[] = MOCK_INTEGRATIONS.map((integration) => ({
    key: integration.key,
    name: integration.name,
    description: integration.description,
    mark: integration.mark,
    color: integration.color,
    connection: null,
    broken: null,
    toolCount: 0,
    connectHref: null,
    disabledReason: "Coming soon.",
    mock: true,
  }));

  return (
    <div className="relative overflow-hidden">
      <HeroWash className="opacity-60" />
      <PageWrap width="wide">
        {result.connected && (
          <p className="flex items-start gap-2 rounded-md bg-success/10 px-3 py-2 text-body-s text-success-text">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              {result.connected} is connected.
              {result.tools && ` It gave ${result.tools} tools.`}
              {result.partial === "write" && " You didn't grant permission to send, so only reading works."}
              {result.partial === "read" && " You didn't grant permission to read, so only drafting and sending work."}
              {result.partial === "read,write" && " No mailbox permission was granted, so no Gmail tool will work — reconnect and approve the boxes."}
              {result.warning === "no_refresh_token" &&
                " It didn't return a refresh token, so this will stop working when the access token expires. Disconnect and connect again."}
              {result.warning === "tools_unavailable" &&
                " Its tool list couldn't be read just yet — try Refresh tools on the tile."}
            </span>
          </p>
        )}
        {result.error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{describeError(result.error)}</span>
          </p>
        )}
        <Connections
          integrations={[gmailView, ...mcpViews, ...mockViews]}
          encryptionReady={encryptionReady}
        />
      </PageWrap>
    </div>
  );
}

/** Plain words for what came back from the connect flow. */
function describeError(code: string) {
  switch (code) {
    case "declined":
      return "You declined the permission, so nothing was connected.";
    case "state_mismatch":
      return "That connect link had expired or didn't match this browser. Please try again.";
    case "google_not_configured":
      return devOnly(
        "Google OAuth isn't configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.",
        "Gmail can't be connected on this server yet.",
      );
    case "no_encryption_key":
      return devOnly(
        "TOKEN_ENCRYPTION_KEY isn't set, so the token couldn't be stored safely. Add it to .env.",
        "Connecting accounts isn't available on this server right now.",
      );
    case "exchange_failed":
      return "The app wouldn't complete the connection. Check the redirect URI is registered, then try again.";
    case "no_code":
      return "No authorisation code came back. Please try again.";
    case "unknown_server":
      return "That app isn't one Omnix can connect.";
    case "server_not_configured":
      return devOnly(
        "That app needs OAuth credentials in .env before it can be connected.",
        "That app can't be connected on this server yet.",
      );
    case "start_failed":
      return "The app's MCP server couldn't be reached to begin the connection. Try again shortly.";
    default:
      return `The connection didn't complete (${code}).`;
  }
}
