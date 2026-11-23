import {
  auth,
  discoverOAuthServerInfo,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";

import { getCredentials, updateTokens } from "@/lib/integrations/connections";
import { newNonce } from "@/lib/integrations/oauth-state";
import {
  forgetRegistration,
  getRegistration,
  saveRegistration,
  type PendingFlow,
} from "./store";
import { preregisteredClient, type McpServerSpec } from "./servers";

/**
 * OAuth for the MCP servers, as the SDK wants it.
 *
 * The SDK drives the whole flow — RFC 9728 discovery, client registration, PKCE, the
 * RFC 8707 `resource` parameter, the RFC 9207 `iss` check, token refresh — and asks an
 * `OAuthClientProvider` to store and fetch each piece. This file is that provider, backed
 * by our own tables, so none of that protocol detail is ours to re-implement (D47).
 *
 * The same class serves two very different moments:
 *
 *   - **Connecting**, where a user is in a browser and a redirect is the expected outcome.
 *   - **Running**, where an agent is mid-turn, nobody is watching, and the only acceptable
 *     outcomes are a usable token or a clear "this account needs reconnecting".
 *
 * `mode` is what tells them apart, and it is why `redirectToAuthorization` throws rather
 * than redirecting during a run: a background task cannot open a consent screen, and
 * silently failing there would leave the user with an agent that stopped working and no
 * reason given.
 */

/** Thrown when a run needs the user to reconnect an account. The message reaches them. */
export class McpReauthorizationRequired extends Error {
  readonly serverName: string;

  constructor(serverName: string) {
    super(
      `The connection to ${serverName} is no longer valid. Ask the user to reconnect it on the Connections page.`,
    );
    this.name = "McpReauthorizationRequired";
    this.serverName = serverName;
  }
}

/** Where every MCP connect flow comes back to. One route; the `state` says which server. */
export function mcpRedirectUri() {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return new URL("/api/connections/mcp/callback", base).toString();
}

type ProviderOptions = {
  server: McpServerSpec;
  userId: number;
  /** Running: the account whose tokens to use and write back. */
  connectionId?: string;
  /** Finishing a connect flow: the verifier and discovery state it started with. */
  resume?: Pick<PendingFlow, "codeVerifier" | "discovery">;
};

class McpOAuthProvider implements OAuthClientProvider {
  private readonly server: McpServerSpec;
  private readonly userId: number;
  private readonly connectionId?: string;

  /** Collected during a connect flow and persisted by the route once it completes. */
  oauthState?: string;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
  authorizationUrl?: URL;
  issuedTokens?: StoredOAuthTokens;

  constructor(options: ProviderOptions) {
    this.server = options.server;
    this.userId = options.userId;
    this.connectionId = options.connectionId;
    this.verifier = options.resume?.codeVerifier;
    this.discovery = options.resume?.discovery as OAuthDiscoveryState | undefined;
  }

  get redirectUrl() {
    return mcpRedirectUri();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Omnix",
      client_uri: process.env.NEXT_PUBLIC_APP_URL || undefined,
      redirect_uris: [mcpRedirectUri()],
      // A refresh token is the difference between an agent that works tomorrow morning
      // and one the user has to reconnect every hour. Asking for it in `grant_types` is
      // also what makes the SDK add `offline_access` where a server wants it explicitly.
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      application_type: "web",
      scope: this.server.scopes.join(" "),
    };
  }

  state() {
    this.oauthState = newNonce();
    return this.oauthState;
  }

  /**
   * The `client_id` to sign in with.
   *
   * For a `preregistered` server this is the app someone created, from the environment;
   * for a `dynamic` one it is whatever the authorization server issued us, looked up by
   * its own `issuer` so a client id minted by one server is never offered to another.
   */
  async clientInformation(ctx?: { issuer: string }): Promise<StoredOAuthClientInformation | undefined> {
    const fixed = preregisteredClient(this.server);
    if (fixed) {
      return { client_id: fixed.clientId, client_secret: fixed.clientSecret, issuer: ctx?.issuer };
    }
    if (!ctx?.issuer) return undefined;

    const stored = await getRegistration(ctx.issuer);
    if (!stored) return undefined;

    return {
      ...stored.info,
      client_id: stored.clientId,
      ...(stored.clientSecret ? { client_secret: stored.clientSecret } : {}),
      issuer: ctx.issuer,
    } as StoredOAuthClientInformation;
  }

  async saveClientInformation(info: StoredOAuthClientInformation, ctx?: { issuer: string }) {
    // Nothing to save for a server we were given credentials for by hand.
    if (this.server.registration.mode === "preregistered") return;

    const issuer = ctx?.issuer ?? info.issuer;
    if (!issuer) return;

    const { client_id, client_secret, ...rest } = info as StoredOAuthClientInformation & {
      client_secret?: string;
    };
    await saveRegistration({
      issuer,
      serverId: this.server.id,
      clientId: client_id,
      clientSecret: client_secret ?? null,
      info: rest as Record<string, unknown>,
    });
  }

  /**
   * The tokens for this account.
   *
   * Read fresh from the row every time rather than held, so a token refreshed by another
   * request is picked up here instead of this one carrying on with a dead one.
   */
  async tokens(): Promise<StoredOAuthTokens | undefined> {
    if (this.issuedTokens) return this.issuedTokens;
    if (!this.connectionId) return undefined;

    const credentials = await getCredentials(this.userId, this.connectionId);
    if (!credentials) return undefined;

    const expiresIn = credentials.expiresAt
      ? Math.floor((credentials.expiresAt.getTime() - Date.now()) / 1000)
      : null;

    return {
      access_token: credentials.accessToken,
      token_type: "Bearer",
      ...(credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {}),
      ...(credentials.scopes.length ? { scope: credentials.scopes.join(" ") } : {}),
      // Seconds from now, which is what the SDK deals in, rather than the absolute
      // instant we store. Omitted once it has run out: a literal `expires_in: 0` would
      // come back through `saveTokens` and be written as "no expiry at all".
      ...(expiresIn !== null && expiresIn > 0 ? { expires_in: expiresIn } : {}),
    };
  }

  /**
   * Stores tokens the SDK just obtained — a first authorization, or a refresh.
   *
   * During a connect flow there is no row yet, so they are held for the route to save
   * with the rest of the connection; during a run they go straight back to the row, which
   * is what makes a refresh outlive the request that happened to trigger it.
   */
  async saveTokens(tokens: StoredOAuthTokens) {
    this.issuedTokens = tokens;
    if (!this.connectionId) return;

    await updateTokens(this.userId, this.connectionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      // Only when the response said so. The SDK also calls `saveTokens` for bookkeeping —
      // stamping the issuer on tokens it just read back from us — and writing `null` on
      // those passes would turn an expiring token into one that looks permanent.
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
      scopes: tokens.scope ? tokens.scope.split(" ").filter(Boolean) : undefined,
    });
  }

  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }

  codeVerifier() {
    if (!this.verifier) throw new Error("This connect flow has no PKCE verifier.");
    return this.verifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.discovery = state;
  }

  discoveryState() {
    return this.discovery;
  }

  /**
   * Where the user would be sent to sign in.
   *
   * Captured rather than acted on: this code may be running inside an agent's turn, where
   * there is no browser to send anywhere. The connect route reads `authorizationUrl` and
   * issues the redirect itself; a run throws instead and tells the user to reconnect.
   */
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
    if (this.connectionId) throw new McpReauthorizationRequired(this.server.name);
  }

  /**
   * Called by the SDK when a credential it holds turns out to be dead.
   *
   * The registration is the one worth acting on: a `client_id` a server has retired makes
   * every future sign-in fail with `invalid_client`, and no amount of the user trying
   * again will clear it — so it is forgotten and the next connect registers afresh.
   */
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "verifier") this.verifier = undefined;
    if (scope === "discovery" || scope === "all") this.discovery = undefined;

    if ((scope === "client" || scope === "all") && this.server.registration.mode === "dynamic") {
      const issuer = this.discovery?.authorizationServerMetadata?.issuer;
      if (issuer) await forgetRegistration(issuer);
    }
  }
}

/**
 * Starts a connect flow: returns the consent screen to send the user to, and the state to
 * remember until they come back.
 *
 * The scope is ours, passed explicitly. Left to the SDK, the "scope selection strategy"
 * falls back to the server's whole `scopes_supported` list — forty-odd scopes for
 * Atlassian, thirty for Slack — which is the opposite of what we want to ask a user to
 * approve (see `McpServerSpec.scopes`).
 */
export async function startMcpAuthorization(options: {
  server: McpServerSpec;
  userId: number;
  returnTo: string;
}): Promise<{ authorizationUrl: string; state: string; flow: PendingFlow }> {
  const provider = new McpOAuthProvider({ server: options.server, userId: options.userId });

  const result = await auth(provider, {
    serverUrl: options.server.url,
    scope: options.server.scopes.join(" "),
  });

  // "AUTHORIZED" would mean the provider already had a usable token, which a brand-new
  // flow never does. Either way, without a URL there is nowhere to send the user.
  if (result !== "REDIRECT" || !provider.authorizationUrl || !provider.oauthState || !provider.verifier) {
    throw new Error(`${options.server.name} didn't return an authorization URL to send you to.`);
  }

  return {
    authorizationUrl: provider.authorizationUrl.toString(),
    state: provider.oauthState,
    flow: {
      userId: options.userId,
      serverId: options.server.id,
      codeVerifier: provider.verifier,
      discovery: (provider.discovery ?? {}) as Record<string, unknown>,
      returnTo: options.returnTo,
    },
  };
}

/**
 * Finishes a connect flow: exchanges the code for tokens and hands them back.
 *
 * The `iss` goes to the SDK rather than being checked here — it validates it against the
 * issuer the flow recorded before the redirect (RFC 9207), which is the defence against
 * a callback arriving from an authorization server we never started with.
 */
export async function finishMcpAuthorization(options: {
  server: McpServerSpec;
  userId: number;
  flow: PendingFlow;
  code: string;
  iss?: string;
}): Promise<StoredOAuthTokens> {
  const provider = new McpOAuthProvider({
    server: options.server,
    userId: options.userId,
    resume: options.flow,
  });

  await auth(provider, {
    serverUrl: options.server.url,
    authorizationCode: options.code,
    iss: options.iss,
    scope: options.server.scopes.join(" "),
  });

  if (!provider.issuedTokens) {
    throw new Error(`${options.server.name} didn't return an access token.`);
  }
  return provider.issuedTokens;
}

/**
 * The provider a tool call uses: bound to one stored account, and unable to redirect.
 *
 * Handed to the transport as its `authProvider`, which asks it for a bearer token before
 * every request and lets the SDK refresh an expired one — writing the new tokens back
 * through `saveTokens` on the way past.
 */
export function runtimeAuthProvider(options: {
  server: McpServerSpec;
  userId: number;
  connectionId: string;
}): OAuthClientProvider {
  return new McpOAuthProvider(options);
}

/**
 * Tells the server to forget the grant, so disconnecting actually ends the access rather
 * than only deleting our copy of the token.
 *
 * Best effort, and deliberately so: the row and its tokens are deleted either way, and a
 * server that is down or has already forgotten the token must not leave the user unable
 * to disconnect. Not every server publishes a `revocation_endpoint` — the ones that don't
 * are left to their own account settings, which is the same position Google would be in
 * if it had no revoke endpoint.
 */
export async function revokeMcpTokens(options: {
  server: McpServerSpec;
  refreshToken: string | null;
  accessToken: string;
}): Promise<boolean> {
  try {
    const info = await discoverOAuthServerInfo(options.server.url);
    const metadata = info.authorizationServerMetadata as
      | { issuer?: string; revocation_endpoint?: string }
      | undefined;
    // `revocation_endpoint` is RFC 8414 and optional, and the SDK's narrower OpenID
    // metadata type doesn't declare it — so it is read off the document as published.
    const endpoint = typeof metadata?.revocation_endpoint === "string" ? metadata.revocation_endpoint : null;
    const issuer = metadata?.issuer;
    if (!endpoint) return false;

    const fixed = preregisteredClient(options.server);
    const registered = issuer && !fixed ? await getRegistration(issuer) : null;
    const clientId = fixed?.clientId ?? registered?.clientId;
    const clientSecret = fixed?.clientSecret ?? registered?.clientSecret ?? null;
    if (!clientId) return false;

    const body = new URLSearchParams({
      // The refresh token revokes the whole grant where there is one; an access token
      // usually revokes only itself.
      token: options.refreshToken ?? options.accessToken,
      token_type_hint: options.refreshToken ? "refresh_token" : "access_token",
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
