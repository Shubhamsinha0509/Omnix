import { and, eq, lt } from "drizzle-orm";

import { db, mcpClients, mcpFlows } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * The two pieces of OAuth state an MCP connect flow needs that aren't a user's tokens:
 * the client registration a server issued us, and the flow that is part-way through the
 * browser round trip.
 *
 * Tokens are not here. They live in `connections` and are reached only through
 * `lib/integrations/connections.ts`, which is still the one door to them
 * (docs/07-security.md#secrets).
 */

/** How long an unfinished connect flow is kept: long enough to read a consent screen. */
const FLOW_MAX_AGE_MS = 10 * 60_000;

/**
 * The binding for a client registration's secret.
 *
 * Keyed by issuer rather than by user, because the registration is Omnix's and not any
 * one person's (D48) — but still bound, so a secret can't be moved between rows.
 */
function clientAad(issuer: string) {
  return `mcp-client:${issuer}`;
}

/** The binding for a flow's PKCE verifier: this user, this flow, and nothing else. */
function flowAad(userId: number, state: string) {
  return `mcp-flow:${userId}:${state}`;
}

export type StoredRegistration = {
  clientId: string;
  clientSecret: string | null;
  /** The rest of what the server returned, handed back to the SDK unchanged. */
  info: Record<string, unknown>;
};

/** The registration for an authorization server, or null if we've never registered. */
export async function getRegistration(issuer: string): Promise<StoredRegistration | null> {
  const [row] = await db.select().from(mcpClients).where(eq(mcpClients.issuer, issuer)).limit(1);
  if (!row) return null;

  return {
    clientId: row.clientId,
    clientSecret: row.clientSecretEnc ? decrypt(row.clientSecretEnc, clientAad(row.issuer)) : null,
    info: (row.info ?? {}) as Record<string, unknown>,
  };
}

/**
 * Stores what an authorization server gave us when it registered Omnix.
 *
 * An upsert, because two users connecting the same server at the same moment both get a
 * registration and both try to save one. Last writer wins and either is usable: the row
 * is a cache of a credential the server minted, not a unique thing we own.
 */
export async function saveRegistration(input: {
  issuer: string;
  serverId: string;
  clientId: string;
  clientSecret?: string | null;
  info: Record<string, unknown>;
}) {
  const clientSecretEnc = input.clientSecret
    ? encrypt(input.clientSecret, clientAad(input.issuer))
    : null;

  await db
    .insert(mcpClients)
    .values({
      issuer: input.issuer,
      serverId: input.serverId,
      clientId: input.clientId,
      clientSecretEnc,
      info: input.info,
    })
    .onConflictDoUpdate({
      target: mcpClients.issuer,
      set: {
        clientId: input.clientId,
        clientSecretEnc,
        info: input.info,
        serverId: input.serverId,
        updatedAt: new Date(),
      },
    });
}

/**
 * Forgets a registration, so the next connect registers again.
 *
 * Needed because a server can retire a `client_id` — once it does, every sign-in fails
 * with `invalid_client` until the stale row is gone, and no amount of retrying by the
 * user fixes that.
 */
export async function forgetRegistration(issuer: string) {
  await db.delete(mcpClients).where(eq(mcpClients.issuer, issuer));
}

export type PendingFlow = {
  userId: number;
  serverId: string;
  codeVerifier: string;
  discovery: Record<string, unknown>;
  returnTo: string;
};

/** Records a connect flow about to send the user to a consent screen. */
export async function saveFlow(state: string, flow: PendingFlow) {
  await db.insert(mcpFlows).values({
    state,
    userId: flow.userId,
    serverId: flow.serverId,
    codeVerifierEnc: encrypt(flow.codeVerifier, flowAad(flow.userId, state)),
    discovery: flow.discovery,
    returnTo: flow.returnTo,
    expiresAt: new Date(Date.now() + FLOW_MAX_AGE_MS),
  });
}

/**
 * Claims a flow by its `state`: returns it and deletes it in one statement.
 *
 * Deleting as part of the claim is the point. A PKCE verifier is single-use, and two
 * callbacks arriving with the same `state` — a double-click, or a replayed URL out of
 * someone's history — must not both be able to redeem a code.
 *
 * Scoped to the signed-in user as well as the state, so a `state` lifted from another
 * person's browser is simply not found.
 */
export async function claimFlow(userId: number, state: string): Promise<PendingFlow | null> {
  const [row] = await db
    .delete(mcpFlows)
    .where(and(eq(mcpFlows.state, state), eq(mcpFlows.userId, userId)))
    .returning();

  if (!row) return null;
  // An expired flow is claimed and thrown away rather than left to be found later.
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return {
    userId: row.userId,
    serverId: row.serverId,
    codeVerifier: decrypt(row.codeVerifierEnc, flowAad(row.userId, row.state)),
    discovery: (row.discovery ?? {}) as Record<string, unknown>,
    returnTo: row.returnTo,
  };
}

/** Clears out flows nobody finished. Called from the nightly sweep. */
export async function purgeExpiredFlows() {
  const deleted = await db
    .delete(mcpFlows)
    .where(lt(mcpFlows.expiresAt, new Date()))
    .returning({ state: mcpFlows.state });
  return deleted.length;
}
