import { eq, like } from "drizzle-orm";

import { connections, db, rateLimits, sandboxes, users } from "@/db";
import { getCredentials } from "@/lib/integrations/connections";
import { revokeToken } from "@/lib/integrations/google";
import { revokeMcpTokens, serverForProvider } from "@/lib/mcp";
import { destroySandbox } from "@/lib/sandbox";

/**
 * Deletes a user's account and everything that belongs to it (docs/07-security.md#privacy,
 * D56). Server only; the caller has checked who is asking.
 *
 * In this order, because two things live outside our database and the row is what points
 * at them:
 * 1. **VMs.** E2B keeps a paused VM until it is killed, files and all.
 * 2. **Connected accounts.** Their grants are revoked at Google and at each MCP server, so
 *    Omnix's access ends there too, not only our copy of the token.
 * 3. **The user row.** Every table that holds the user's data references it with
 *    `on delete cascade`: agents, chats, messages, tasks, runs and their steps, approvals,
 *    notifications, connections, shared files, VM records and usage.
 * 4. **Rate-limit counters**, which are keyed by text, not by reference.
 *
 * Steps 1 and 2 are best effort, like a single disconnect or agent delete: a provider that
 * is down must not keep someone's data here. Their failures are logged and counted.
 */
export async function deleteAccountData(userId: number) {
  const report = { vms: 0, vmFailures: 0, connections: 0, revokeFailures: 0 };

  const vms = await db
    .select({ agentId: sandboxes.agentId, providerId: sandboxes.providerId })
    .from(sandboxes)
    .where(eq(sandboxes.userId, userId));
  for (const vm of vms) {
    if (!vm.providerId) continue;
    try {
      await destroySandbox(userId, vm.agentId);
      report.vms++;
    } catch (error) {
      report.vmFailures++;
      console.error(`Account deletion: couldn't kill VM of agent ${vm.agentId}:`, error);
    }
  }

  const owned = await db.select({ id: connections.id }).from(connections).where(eq(connections.userId, userId));
  for (const { id } of owned) {
    try {
      const credentials = await getCredentials(userId, id);
      if (!credentials) continue;
      if (credentials.provider === "gmail") {
        // The refresh token revokes the whole grant; the access token only itself.
        await revokeToken(credentials.refreshToken ?? credentials.accessToken);
      }
      const server = serverForProvider(credentials.provider);
      if (server) {
        await revokeMcpTokens({ server, refreshToken: credentials.refreshToken, accessToken: credentials.accessToken });
      }
      report.connections++;
    } catch (error) {
      report.revokeFailures++;
      console.error(`Account deletion: couldn't revoke connection ${id}:`, error);
    }
  }

  const deleted = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  await db.delete(rateLimits).where(like(rateLimits.key, `%:${userId}:%`));

  return { deleted: deleted.length === 1, ...report };
}
