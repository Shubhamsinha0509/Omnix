import { NextResponse } from "next/server";

import { gmailAuthUrl, hasGoogleOAuth } from "@/lib/integrations/google";
import { newNonce, nonceCookieName, signState } from "@/lib/integrations/oauth-state";
import { getCurrentUser } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";

/**
 * GET /api/connections/gmail/start — begins the Gmail connect flow.
 *
 * A GET that redirects, so it can be a plain link in the UI. It mints a signed `state`
 * and leaves its nonce in a short-lived cookie; the callback will only accept a state
 * whose nonce matches, which is what stops someone else's authorisation being planted in
 * this account (see lib/integrations/oauth-state.ts).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));

  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));

  if (!hasGoogleOAuth()) return fail(request, returnTo, "google_not_configured");
  // Better to stop here than to finish the dance and be unable to store the token.
  if (!hasEncryptionKey()) return fail(request, returnTo, "no_encryption_key");

  const nonce = newNonce();
  let authUrl: string;
  try {
    authUrl = gmailAuthUrl(signState({ userId: user.id, provider: "gmail", nonce, returnTo }));
  } catch (error) {
    console.error("Couldn't start the Gmail connect flow:", error);
    return fail(request, returnTo, "start_failed");
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(nonceCookieName("gmail"), nonce, {
    httpOnly: true,
    sameSite: "lax", // must survive the redirect back from Google
    secure: new URL(request.url).protocol === "https:",
    path: "/api/connections/gmail",
    maxAge: 600,
  });
  return response;
}

/** Only our own workspace pages, so `returnTo` can't be used as an open redirect. */
function safeReturnTo(value: string | null) {
  return value && /^\/workspace(\/[\w\-/]*)?$/.test(value) ? value : "/workspace/integrations";
}

function fail(request: Request, returnTo: string, reason: string) {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}
