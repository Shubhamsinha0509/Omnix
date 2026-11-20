/**
 * Google OAuth for the Gmail *connection* — a different thing from "Sign in with Google".
 *
 * Signing in proves who someone is and is handled by NextAuth (D18). This flow asks for
 * access to their mailbox, which is a separate consent with its own scopes, its own
 * refresh token, and its own disconnect. A user can sign in with GitHub and still connect
 * Gmail, or sign in with Google and never connect it.
 *
 * See docs/05-integrations.md#gmail.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * The narrowest scopes that cover the Phase 3 tools.
 *
 * `gmail.readonly` is for `gmail.search` and `gmail.read`; `gmail.compose` covers both
 * creating drafts and sending, so no separate `gmail.send` scope is needed. We don't ask
 * for `gmail.modify` — labelling and archiving aren't tools yet, and asking for more than
 * we use is exactly what Google's review looks for.
 *
 * Both are Google **restricted scopes**: fine for test users, but a public launch needs
 * verification and a CASA assessment (docs/07-security.md#google-verification).
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/** Scope a tool needs, checked against what the user actually granted. */
export const SCOPE_READ = GMAIL_SCOPES[0];
export const SCOPE_COMPOSE = GMAIL_SCOPES[1];

/**
 * The OAuth client. By default this is the same Google client as sign-in, so there is one
 * thing to configure — both redirect URIs just have to be registered on it. Set
 * `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` to split them later, which is worth doing
 * before verification so a restricted-scope review can't hold up sign-in.
 */
function credentials() {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  // A Google client id always ends `.apps.googleusercontent.com`, so this tells a real one
  // from the placeholder `.env` ships with. Worth being exact: the alternative is a
  // "Connect Gmail" button that sends the user to Google only to be told `invalid_client`.
  if (!clientId?.includes("apps.googleusercontent.com") || !clientSecret) {
    throw new Error(
      "Google OAuth isn't configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env " +
        "(see docs/README.md#connecting-gmail).",
    );
  }
  return { clientId, clientSecret };
}

/** True when Gmail can be connected at all, so the UI can say so instead of failing. */
export function hasGoogleOAuth() {
  try {
    credentials();
    return true;
  } catch {
    return false;
  }
}

/**
 * Where Google sends the user back. It must match a registered redirect URI **exactly**,
 * so it is derived from one configured origin rather than the incoming request — a
 * request's own host can be set by whoever made it.
 */
export function gmailRedirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return new URL("/api/connections/gmail/callback", base).toString();
}

/** The consent screen to send the user to. */
export function gmailAuthUrl(state: string) {
  const { clientId } = credentials();
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    // A refresh token is the only way to keep working after an hour, and Google issues
    // one only for an offline request — with `prompt=consent` every time, because
    // otherwise a user who has consented before comes back with no refresh token at all.
    access_type: "offline",
    prompt: "consent",
    // Keep scopes the user granted elsewhere (e.g. sign-in) instead of replacing them.
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

export type GoogleTokens = {
  accessToken: string;
  /** Only present on a first authorisation, or whenever `prompt=consent` was used. */
  refreshToken: string | null;
  expiresAt: Date | null;
  /** What the user actually granted, which can be less than we asked for. */
  scopes: string[];
};

/** Turns the `code` from the callback into tokens. */
export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = credentials();
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: gmailRedirectUri(),
  });
}

/**
 * Trades a refresh token for a new access token.
 *
 * Throws `GoogleAuthError` with `permanent: true` when Google says the grant itself is
 * gone (`invalid_grant`: the user revoked access, or changed their password). The caller
 * marks the connection revoked on that, so the user is told to reconnect instead of every
 * run failing in the same unexplained way.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = credentials();
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
}

/**
 * Tells Google to forget the grant, so disconnecting in Omnix actually ends the access
 * rather than only deleting our copy of the token.
 *
 * Best effort: an already-dead token answers 400, and the row is deleted either way.
 */
export async function revokeToken(token: string) {
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export class GoogleAuthError extends Error {
  /** True when retrying will never help: the user has to reconnect. */
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "GoogleAuthError";
    this.permanent = permanent;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    // A network problem is temporary; don't let it revoke a perfectly good connection.
    throw new GoogleAuthError(`Couldn't reach Google: ${(error as Error).message}`, false);
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !payload?.access_token) {
    const code = payload?.error ?? `http_${response.status}`;
    throw new GoogleAuthError(
      `Google rejected the request (${code}${payload?.error_description ? `: ${payload.error_description}` : ""}).`,
      // `invalid_grant` means the grant is gone for good; `invalid_client` is our own
      // misconfiguration, which also won't fix itself on a retry.
      code === "invalid_grant" || code === "invalid_client",
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    // A minute short of what Google says, so we refresh before a token dies mid-request.
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
    scopes: payload.scope ? payload.scope.split(" ").filter(Boolean) : [],
  };
}
