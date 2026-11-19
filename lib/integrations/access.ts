import {
  getCredentials,
  setConnectionStatus,
  updateAccessToken,
  type Credentials,
} from "./connections";
import { GoogleAuthError, refreshAccessToken } from "./google";

/**
 * The bridge between a connection row and a running tool.
 *
 * A tool never sees `connections`, never decrypts anything and never learns a refresh
 * token. It is handed a `ToolAuth` and asks it for an access token at the moment it makes
 * a request; keeping the expiry, the refresh and the "this connection is dead, tell the
 * user to reconnect" bookkeeping in one place means every integration gets it right.
 *
 * Nothing here is ever put in a prompt or sent to the browser (docs/07-security.md).
 */

export type ToolAuth = {
  connectionId: string;
  provider: string;
  /** The account, for messages the user reads: "sam@example.com". */
  accountLabel: string;
  /** What the user actually granted. */
  scopes: string[];
  /** True when this connection covers the given scope. */
  hasScope: (scope: string) => boolean;
  /** A usable access token, refreshed first if it has expired. */
  token: () => Promise<string>;
  /** Called when the provider rejects our token: the user must reconnect. */
  markRevoked: () => Promise<void>;
};

/** Raised when a tool can't get at the account it needs. The message goes to the model. */
export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

/**
 * Opens a connection for one tool call.
 *
 * Deliberately called per call rather than once per run: the token is decrypted at the
 * moment it is used and goes out of scope straight after, so a long run doesn't keep a
 * live key to someone's inbox sitting in memory between steps.
 */
export async function openConnection(userId: number, connectionId: string): Promise<ToolAuth> {
  const credentials = await getCredentials(userId, connectionId);
  if (!credentials) {
    throw new ConnectionError(
      "That account isn't connected any more. Ask the user to reconnect it on the Connections page.",
    );
  }

  return {
    connectionId: credentials.connectionId,
    provider: credentials.provider,
    accountLabel: credentials.accountLabel,
    scopes: credentials.scopes,
    hasScope: (scope) => credentials.scopes.includes(scope),
    token: () => freshToken(userId, credentials),
    markRevoked: async () => {
      await setConnectionStatus(userId, credentials.connectionId, "revoked");
    },
  };
}

/** Returns a live access token, refreshing it first if the stored one has expired. */
async function freshToken(userId: number, credentials: Credentials) {
  if (!credentials.isExpired) return credentials.accessToken;

  if (!credentials.refreshToken) {
    await setConnectionStatus(userId, credentials.connectionId, "expired");
    throw new ConnectionError(
      `The connection to ${credentials.accountLabel} has expired. Ask the user to reconnect it on the Connections page.`,
    );
  }

  try {
    const refreshed = await refreshProviderToken(credentials.provider, credentials.refreshToken);
    await updateAccessToken(userId, credentials.connectionId, refreshed.accessToken, refreshed.expiresAt);
    return refreshed.accessToken;
  } catch (error) {
    // A revoked grant is permanent, so record it and stop every later run guessing.
    // A network blip is not, and must not cost the user their connection.
    if (error instanceof GoogleAuthError && error.permanent) {
      await setConnectionStatus(userId, credentials.connectionId, "revoked");
      throw new ConnectionError(
        `Access to ${credentials.accountLabel} was revoked. Ask the user to reconnect it on the Connections page.`,
      );
    }
    throw new ConnectionError(
      `Couldn't refresh access to ${credentials.accountLabel}: ${(error as Error).message}`,
    );
  }
}

/** One provider today; Phase 5 adds the MCP servers' own refresh here. */
function refreshProviderToken(provider: string, refreshToken: string) {
  if (provider === "gmail") return refreshAccessToken(refreshToken);
  throw new ConnectionError(`Omnix doesn't know how to refresh a "${provider}" connection.`);
}
