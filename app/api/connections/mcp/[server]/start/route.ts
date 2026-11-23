import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";
import { getMcpServer, isMcpServerConfigured, saveFlow, startMcpAuthorization } from "@/lib/mcp";

/**
 * GET /api/connections/mcp/:server/start — begins connecting an MCP server.
 *
 * A GET that redirects, so it can be a plain link, exactly like the Gmail flow. What it
 * does differently is that the whole OAuth dance is the SDK's: discovery against the
 * server's RFC 9728 metadata, registering Omnix with its authorization server if it
 * allows that (D48), PKCE, and the RFC 8707 `resource` parameter. All this route does is
 * ask for the consent URL, remember the flow, and send the user there.
 *
 * The flow is remembered in a row keyed by `state` **and** this user's id, which is what
 * stops someone else's authorization being planted in this account: a `state` that
 * belongs to another user's flow simply isn't found on the way back
 * (see `claimFlow` in lib/mcp/store.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ server: string }> }) {
  const { server: serverId } = await params;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));

  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  // Not on the allow-list is the whole point of having one (D49).
  const server = getMcpServer(serverId);
  if (!server) return fail(request, returnTo, "unknown_server");

  // Better to stop here than to finish the dance and be unable to store the token.
  if (!hasEncryptionKey()) return fail(request, returnTo, "no_encryption_key");
  if (!isMcpServerConfigured(server)) return fail(request, returnTo, "server_not_configured");

  try {
    const { authorizationUrl, state, flow } = await startMcpAuthorization({
      server,
      userId: user.id,
      returnTo,
    });
    await saveFlow(state, flow);
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    // Discovery or registration failed — the server is down, or won't have us.
    console.error(`Couldn't start the ${serverId} connect flow:`, error);
    return fail(request, returnTo, "start_failed");
  }
}

/** Only our own workspace pages, so `returnTo` can't be used as an open redirect. */
function safeReturnTo(value: string | null) {
  return value && /^\/workspace(\/[\w\-/]*)?$/.test(value) ? value : "/workspace/integrations";
}

function fail(request: Request, returnTo: string, reason: string) {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}
