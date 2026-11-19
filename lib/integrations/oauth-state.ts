import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The `state` parameter for a connect flow, signed so only we can mint one.
 *
 * Without it, anyone could link their own Google account into someone else's Omnix
 * account by getting them to open a crafted callback URL (OAuth's login CSRF). The state
 * carries the user it was issued for and an expiry, and is signed with `NEXTAUTH_SECRET`;
 * the callback also checks a one-time nonce it stored in a cookie, so a state copied out
 * of someone else's browser history is useless on its own.
 *
 * Generic on purpose: the per-user MCP OAuth flows in Phase 5 need exactly this.
 */

const MAX_AGE_MS = 10 * 60_000; // long enough to read a consent screen, short enough to matter

export type OAuthState = {
  /** The Omnix user this flow was started for. */
  userId: number;
  /** Which connect flow it belongs to, e.g. "gmail". */
  provider: string;
  /** Matched against the cookie the start route set, so the state can only be used once. */
  nonce: string;
  /** Where to send the user when the flow finishes. */
  returnTo: string;
  issuedAt: number;
};

/** A fresh nonce for a connect flow. Goes in both the state and the cookie. */
export function newNonce() {
  return randomBytes(16).toString("base64url");
}

export function signState(state: Omit<OAuthState, "issuedAt">) {
  const payload = base64url(JSON.stringify({ ...state, issuedAt: Date.now() }));
  return `${payload}.${sign(payload)}`;
}

/**
 * Checks a state's signature, age and nonce, and returns what it carried.
 *
 * Every failure is the same shape on purpose: the callback shows one generic message
 * rather than telling a prober which part it got wrong.
 */
export function verifyState(value: string, nonceFromCookie: string | undefined): OAuthState | null {
  const at = value.lastIndexOf(".");
  if (at <= 0) return null;

  const payload = value.slice(0, at);
  const signature = value.slice(at + 1);
  if (!equals(signature, sign(payload))) return null;

  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }

  if (typeof state.userId !== "number" || typeof state.nonce !== "string") return null;
  if (!state.issuedAt || Date.now() - state.issuedAt > MAX_AGE_MS) return null;
  if (!nonceFromCookie || !equals(state.nonce, nonceFromCookie)) return null;

  return state;
}

/** The cookie name a flow's nonce is stored under. */
export function nonceCookieName(provider: string) {
  return `omnix_oauth_${provider}`;
}

function sign(payload: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  // The same rule as the session cookie: no fallback secret, or anyone could forge one.
  if (!secret) throw new Error("NEXTAUTH_SECRET isn't set, so a connect flow can't be signed.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function base64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Constant-time compare, so a wrong signature can't be found one character at a time. */
function equals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
