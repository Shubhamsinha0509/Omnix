import { notFound } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { HeroWash, PageWrap } from "@/components/custom/design/HeroWash";
import Connections from "@/components/custom/workspace/Connections";
import { TOOLS } from "@/lib/tools";
import { getCurrentUser } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";
import { listConnections } from "@/lib/integrations/connections";
import { hasGoogleOAuth } from "@/lib/integrations/google";

type Props = {
  /** The connect flow redirects back here with its result in the query string. */
  searchParams: Promise<{
    connected?: string;
    error?: string;
    partial?: string;
    warning?: string;
  }>;
};

/** Integrations (design/reference/15-integrations.html). */
export default async function IntegrationsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const [connections, result] = await Promise.all([listConnections(user.id), searchParams]);

  // How many tools each provider gives agents, for the tiles ("4 tools").
  const toolCounts: Record<string, number> = {};
  for (const tool of Object.values(TOOLS)) {
    if ("provider" in tool && tool.provider) toolCounts[tool.provider] = (toolCounts[tool.provider] ?? 0) + 1;
  }

  return (
    <div className="relative overflow-hidden">
      <HeroWash className="opacity-60" />
      <PageWrap width="wide">
        {result.connected && (
          <p className="flex items-start gap-2 rounded-md bg-success/10 px-3 py-2 text-body-s text-success-text">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              {result.connected} is connected.
              {result.partial === "write" && " You didn't grant permission to send, so only reading works."}
              {result.partial === "read" && " You didn't grant permission to read, so only drafting and sending work."}
              {result.partial === "read,write" && " No mailbox permission was granted, so no Gmail tool will work — reconnect and approve the boxes."}
              {result.warning === "no_refresh_token" &&
                " Google didn't return a refresh token, so this will stop working in about an hour. Disconnect and connect again."}
            </span>
          </p>
        )}
        {result.error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{describeError(result.error)}</span>
          </p>
        )}
        <Connections
          connections={connections}
          toolCounts={toolCounts}
          googleReady={hasGoogleOAuth()}
          encryptionReady={hasEncryptionKey()}
        />
      </PageWrap>
    </div>
  );
}

/** Plain words for what came back from the connect flow. */
function describeError(code: string) {
  switch (code) {
    case "declined":
      return "You declined the permission, so nothing was connected.";
    case "state_mismatch":
      return "That connect link had expired or didn't match this browser. Please try again.";
    case "google_not_configured":
      return "Google OAuth isn't configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.";
    case "no_encryption_key":
      return "TOKEN_ENCRYPTION_KEY isn't set, so the token couldn't be stored safely. Add it to .env.";
    case "exchange_failed":
      return "Google wouldn't complete the connection. Check the redirect URI is registered, then try again.";
    case "no_code":
      return "Google didn't return an authorisation code. Please try again.";
    default:
      return `The connection didn't complete (${code}).`;
  }
}
