import { and, asc, eq } from "drizzle-orm";

import { connections, db, type Connection } from "@/db";
import { decrypt, encrypt, tokenAad } from "@/lib/crypto";

/**
 * The only way to read or write a connection's tokens.
 *
 * Two rules live here rather than in every caller:
 *   1. Every lookup is scoped to a `userId`. A connection belongs to one person (D14),
 *      and an agent run must never reach another person's inbox.
 *   2. Decrypted tokens leave only through `getCredentials`. Everything a page or an API
 *      route can call returns `SafeConnection`, which has no token material in it at all.
 *
 * See docs/07-security.md.
 */

/** A connection as the UI may see it: no tokens, encrypted or otherwise. */
export type SafeConnection = {
  id: string;
  provider: string;
  kind: "builtin" | "mcp";
  accountLabel: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  expiresAt: Date | null;
  createdAt: Date;
};

function toSafe(row: Connection): SafeConnection {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    accountLabel: row.accountLabel,
    scopes: row.scopes,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

type SaveConnection = {
  userId: number;
  provider: string;
  kind?: "builtin" | "mcp";
  serverUrl?: string | null;
  /** The email address or workspace name — what identifies this account to the user. */
  accountLabel: string;
  accessToken: string;
  refreshToken?: string | null;
  scopes?: string[];
  expiresAt?: Date | null;
};

/**
 * Stores a newly authorised account, or updates it if the same account is reconnected.
 *
 * A refresh token is only overwritten when a new one is supplied: providers often return
 * one just once, on the first authorisation, and send only access tokens afterwards.
 * Blindly writing `undefined` over it would silently break refreshing later.
 */
export async function saveConnection(input: SaveConnection): Promise<SafeConnection> {
  const aad = tokenAad(input.userId, input.provider);
  const accessTokenEnc = encrypt(input.accessToken, aad);
  const refreshTokenEnc = input.refreshToken ? encrypt(input.refreshToken, aad) : null;

  const [row] = await db
    .insert(connections)
    .values({
      userId: input.userId,
      provider: input.provider,
      kind: input.kind ?? "builtin",
      serverUrl: input.serverUrl ?? null,
      accountLabel: input.accountLabel,
      accessTokenEnc,
      refreshTokenEnc,
      scopes: input.scopes ?? [],
      expiresAt: input.expiresAt ?? null,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [connections.userId, connections.provider, connections.accountLabel],
      set: {
        accessTokenEnc,
        ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
        scopes: input.scopes ?? [],
        expiresAt: input.expiresAt ?? null,
        serverUrl: input.serverUrl ?? null,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning();

  return toSafe(row);
}

/** Everything this user has connected, for the connections page. Never includes tokens. */
export async function listConnections(userId: number): Promise<SafeConnection[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(eq(connections.userId, userId))
    .orderBy(asc(connections.provider), asc(connections.accountLabel));
  return rows.map(toSafe);
}

/** One connection, if this user owns it. Never includes tokens. */
export async function getConnection(userId: number, connectionId: string): Promise<SafeConnection | null> {
  const row = await findOwned(userId, connectionId);
  return row ? toSafe(row) : null;
}

/** The active connection for a provider, e.g. the inbox a Gmail tool should use. */
export async function getActiveConnection(userId: number, provider: string): Promise<SafeConnection | null> {
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.userId, userId),
        eq(connections.provider, provider),
        eq(connections.status, "active"),
      ),
    )
    .orderBy(asc(connections.createdAt))
    .limit(1);
  return row ? toSafe(row) : null;
}

export type Credentials = {
  connectionId: string;
  provider: string;
  accountLabel: string;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
  /** True when the access token is past, or nearly past, its expiry. */
  isExpired: boolean;
};

/**
 * The decrypted tokens for a connection — the one function that returns them.
 *
 * Call it at the moment a tool runs and let the result go out of scope; never store it,
 * log it, return it to the browser or put it in a prompt. A `null` means the connection
 * isn't this user's, or isn't there.
 */
export async function getCredentials(userId: number, connectionId: string): Promise<Credentials | null> {
  const row = await findOwned(userId, connectionId);
  if (!row) return null;

  const aad = tokenAad(row.userId, row.provider);
  return {
    connectionId: row.id,
    provider: row.provider,
    accountLabel: row.accountLabel,
    accessToken: decrypt(row.accessTokenEnc, aad),
    refreshToken: row.refreshTokenEnc ? decrypt(row.refreshTokenEnc, aad) : null,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    // A minute's grace, so a token that dies mid-request is refreshed beforehand.
    isExpired: row.expiresAt ? row.expiresAt.getTime() - 60_000 <= Date.now() : false,
  };
}

/** Writes a refreshed access token back, keeping the existing refresh token. */
export async function updateAccessToken(
  userId: number,
  connectionId: string,
  accessToken: string,
  expiresAt: Date | null,
) {
  const row = await findOwned(userId, connectionId);
  if (!row) return false;

  await db
    .update(connections)
    .set({
      accessTokenEnc: encrypt(accessToken, tokenAad(row.userId, row.provider)),
      expiresAt,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(connections.id, row.id));
  return true;
}

/**
 * Marks a connection as expired or revoked — used when a provider rejects our token,
 * so the user is told to reconnect instead of every run failing mysteriously.
 */
export async function setConnectionStatus(
  userId: number,
  connectionId: string,
  status: "active" | "expired" | "revoked",
) {
  const result = await db
    .update(connections)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
    .returning({ id: connections.id });
  return result.length > 0;
}

/** Disconnects an account: the row and its tokens are deleted outright. */
export async function deleteConnection(userId: number, connectionId: string) {
  const result = await db
    .delete(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
    .returning({ id: connections.id });
  return result.length > 0;
}

/** Ids are UUIDs; anything else is "not found", not a database error. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every lookup goes through here, so ownership is never checked by accident. */
async function findOwned(userId: number, connectionId: string) {
  if (!UUID.test(connectionId)) return null;

  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.userId, userId)))
    .limit(1);
  return row ?? null;
}
