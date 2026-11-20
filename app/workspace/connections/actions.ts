"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { deleteConnection, getCredentials } from "@/lib/integrations/connections";
import { revokeToken } from "@/lib/integrations/google";

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

  const deleted = await deleteConnection(user.id, connectionId);
  if (!deleted) return { error: "Couldn't disconnect that account. Please try again." };

  revalidatePath("/workspace/connections");
  revalidatePath("/workspace", "layout");
  return undefined;
}
