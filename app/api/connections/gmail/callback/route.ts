import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { saveConnection } from "@/lib/integrations/connections";
import { SCOPE_COMPOSE, SCOPE_READ, exchangeCode } from "@/lib/integrations/google";
import { fetchEmailAddress } from "@/lib/integrations/gmail";
import { nonceCookieName, verifyState } from "@/lib/integrations/oauth-state";

/**
 * GET /api/connections/gmail/callback — where Google sends the user back.
 *
 * Nothing here trusts the query string on its own. The `state` must carry our signature
 * and a nonce matching the cookie the start route set, and it must belong to the user who
 * is signed in *now* — otherwise an authorisation could be finished into the wrong
 * account. Only then are the tokens exchanged and stored, encrypted (D13).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));

  const nonce = cookieValue(request, nonceCookieName("gmail"));
  const state = params.get("state");
  const verified = state ? verifyState(state, nonce) : null;

  // Without a valid state we don't even know where the user meant to end up.
  if (!verified || verified.provider !== "gmail" || verified.userId !== user.id) {
    return done(request, "/workspace/integrations", { error: "state_mismatch" });
  }
  const returnTo = verified.returnTo;

  // The user said no on Google's screen. Not an error worth shouting about.
  const denied = params.get("error");
  if (denied) return done(request, returnTo, { error: denied === "access_denied" ? "declined" : denied });

  const code = params.get("code");
  if (!code) return done(request, returnTo, { error: "no_code" });

  try {
    const tokens = await exchangeCode(code);
    const emailAddress = await fetchEmailAddress(tokens.accessToken);

    await saveConnection({
      userId: user.id,
      provider: "gmail",
      kind: "builtin",
      accountLabel: emailAddress,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      expiresAt: tokens.expiresAt,
    });

    // Google lets people untick scopes, and an agent that can read but not send is a
    // reasonable thing to want — so say what is missing rather than refusing the connection.
    const missing = [
      ...(tokens.scopes.includes(SCOPE_READ) ? [] : ["read"]),
      ...(tokens.scopes.includes(SCOPE_COMPOSE) ? [] : ["write"]),
    ];

    return done(request, returnTo, {
      connected: emailAddress,
      ...(missing.length > 0 ? { partial: missing.join(",") } : {}),
      // Without a refresh token the connection dies in an hour, which is worth saying now.
      ...(tokens.refreshToken ? {} : { warning: "no_refresh_token" }),
    });
  } catch (error) {
    console.error("Gmail connect failed:", error);
    return done(request, returnTo, { error: "exchange_failed" });
  }
}

/** Redirects back to the page the flow started from, and drops the one-time nonce. */
function done(request: Request, returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo, request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = NextResponse.redirect(url);
  response.cookies.set(nonceCookieName("gmail"), "", {
    path: "/api/connections/gmail",
    maxAge: 0,
  });
  return response;
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}
