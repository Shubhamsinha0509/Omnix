import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { saveConnection } from "@/lib/integrations/connections";
import {
  claimFlow,
  finishMcpAuthorization,
  getMcpServer,
  mcpProvider,
  refreshMcpTools,
} from "@/lib/mcp";

/**
 * GET /api/connections/mcp/callback — where every MCP server sends the user back.
 *
 * One callback for all of them: the `state` is what says which flow this is, and it is
 * looked up against the signed-in user, so a callback carrying somebody else's `state`
 * finds nothing. Claiming the flow also deletes it, which is what makes the PKCE verifier
 * single-use (lib/mcp/store.ts).
 *
 * The code exchange itself is the SDK's, including the RFC 9207 `iss` check against the
 * issuer the flow recorded before the redirect — the defence against a callback arriving
 * from an authorization server we never started with.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));

  const state = params.get("state");
  const flow = state ? await claimFlow(user.id, state) : null;

  // Without a flow we don't even know which server this was, or where to send them back to.
  if (!flow) return done(request, "/workspace/integrations", { error: "state_mismatch" });

  const server = getMcpServer(flow.serverId);
  if (!server) return done(request, flow.returnTo, { error: "unknown_server" });

  // The user said no on the consent screen. Not an error worth shouting about.
  const denied = params.get("error");
  if (denied) {
    return done(request, flow.returnTo, {
      error: denied === "access_denied" ? "declined" : denied,
    });
  }

  const code = params.get("code");
  if (!code) return done(request, flow.returnTo, { error: "no_code" });

  try {
    const tokens = await finishMcpAuthorization({
      server,
      userId: user.id,
      flow,
      code,
      iss: params.get("iss") ?? undefined,
    });

    const connection = await saveConnection({
      userId: user.id,
      provider: mcpProvider(server.id),
      kind: "mcp",
      serverUrl: server.url,
      // The server's name, not an account name. These servers don't tell us which
      // workspace we landed in without a provider-specific call, and the unique index on
      // (user, provider, label) then means reconnecting updates this row rather than
      // piling up duplicates — one account per server per user, which is all Phase 5 needs.
      accountLabel: server.name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      scopes: tokens.scope ? tokens.scope.split(" ").filter(Boolean) : [],
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    });

    // First read of the tool list, so the agent settings page has something to show
    // immediately. Best effort: the account is connected either way, and the page says
    // when the list is missing (`lib/mcp/tools.ts`).
    const cached = await refreshMcpTools(user.id, connection);

    return done(request, flow.returnTo, {
      connected: server.name,
      tools: String(cached.tools.length),
      // Without a refresh token the connection dies when the access token does, which is
      // worth saying now rather than when an agent stops working tomorrow.
      ...(tokens.refresh_token ? {} : { warning: "no_refresh_token" }),
      ...(cached.error ? { warning: "tools_unavailable" } : {}),
    });
  } catch (error) {
    console.error(`${server.name} connect failed:`, error);
    return done(request, flow.returnTo, { error: "exchange_failed" });
  }
}

/** Back to the page the flow started from, with the result in the query string. */
function done(request: Request, returnTo: string, values: Record<string, string>) {
  const url = new URL(returnTo, request.url);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}
