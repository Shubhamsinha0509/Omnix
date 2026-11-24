"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { deleteConnection, getConnection, getCredentials } from "@/lib/integrations/connections";
import { revokeToken } from "@/lib/integrations/google";
import { refreshMcpTools, revokeMcpTokens, serverForProvider } from "@/lib/mcp";

export type ConnectionActionResult = { error: string } | undefined;

/**
 * Disconnects an account.
 *
 * The grant is revoked with the provider first, so the access actually ends rather than
 * only our copy of the token disappearing — and then the row is deleted, tokens and all.
 * Revocation is best effort: a token Google has already forgotten answers with an error,
 * and leaving the row behind in that case would be worse than deleting it.
 *
 * Any agent tool pointing at this account has its `connection_id` set to null by the
 * database, so the tool shows as needing an account instead of quietly vanishing.
 */
export async function disconnectAccount(connectionId: string): Promise<ConnectionActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  // Scoped to this user, so one person can't disconnect another's account.
  const credentials = await getCredentials(user.id, connectionId);
  if (!credentials) return { error: "That account isn't connected." };

  if (credentials.provider === "gmail") {
    // The refresh token revokes the whole grant; the access token only revokes itself.
    await revokeToken(credentials.refreshToken ?? credentials.accessToken);
  }

  // An MCP server's own revocation endpoint, where it publishes one (Phase 5).
  const mcpServer = serverForProvider(credentials.provider);
  if (mcpServer) {
    await revokeMcpTokens({
      server: mcpServer,
      refreshToken: credentials.refreshToken,
      accessToken: credentials.accessToken,
    });
  }

  const deleted = await deleteConnection(user.id, connectionId);
  if (!deleted) return { error: "Couldn't disconnect that account. Please try again." };

  revalidatePath("/workspace/integrations");
  revalidatePath("/workspace", "layout");
  return undefined;
}

/**
 * Asks a connected MCP server what tools it has, now, and stores the answer.
 *
 * Nothing refreshes the list on a page load — a run must never wait on somebody else's
 * server to find out what it can do — so the list is an hour old at most by the sweep,
 * and this is the button for when that is too old: a tool was just added in Notion, or
 * last night's refresh failed (see `lib/mcp/tools.ts`).
 */
export async function refreshServerTools(connectionId: string): Promise<ConnectionActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  const connection = await getConnection(user.id, connectionId);
  if (!connection) return { error: "That account isn't connected." };
  if (!serverForProvider(connection.provider)) return { error: "That isn't an MCP connection." };

  const result = await refreshMcpTools(user.id, connection);

  revalidatePath("/workspace/integrations");
  revalidatePath("/workspace", "layout");
  return result.error ? { error: result.error } : undefined;
}
