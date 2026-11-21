"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Search, Unplug } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntegrationTile } from "@/components/custom/design/IntegrationTile";
import { disconnectAccount } from "@/app/workspace/integrations/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import { MOCK_INTEGRATIONS } from "@/lib/mock-data";

type Props = {
  connections: SafeConnection[];
  /** How many tools each provider gives agents (gmail: 4). */
  toolCounts: Record<string, number>;
  /** False when the Google client id and secret aren't configured yet. */
  googleReady: boolean;
  /** Set when the token-encryption key is missing: no token can be stored at all. */
  encryptionReady: boolean;
};

const GMAIL_CONNECT = "/api/connections/gmail/start?returnTo=/workspace/integrations";

type Filter = "all" | "connected" | "available";

/**
 * Integrations (15-integrations): the apps agents can use. Connecting one gives no agent
 * access by itself — each agent's tools are switched on one by one in its Tools tab.
 *
 * Gmail is real: Connect runs its OAuth flow, and switching the tile off disconnects the
 * account (after asking). The rest come from MOCK_INTEGRATIONS until they exist.
 */
export default function Connections({ connections, toolCounts, googleReady, encryptionReady }: Props) {
  const [confirming, setConfirming] = useState<SafeConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [isWorking, startWorking] = useTransition();

  const gmail = connections.filter((connection) => connection.provider === "gmail");
  const gmailActive = gmail.find((connection) => connection.status === "active") ?? null;
  const gmailBroken = !gmailActive ? (gmail[0] ?? null) : null;
  const canConnect = googleReady && encryptionReady;
  const connectedCount = gmailActive ? 1 : 0;

  const disconnect = (connection: SafeConnection) => {
    setError(null);
    startWorking(async () => {
      const result = await disconnectAccount(connection.id);
      setConfirming(null);
      if (result?.error) setError(result.error);
    });
  };

  const tiles = [
    {
      key: "gmail",
      name: "Gmail",
      description: "Search, read and draft email. Sending needs your OK.",
      mark: "G",
      color: "#EA4335",
      connected: Boolean(gmailActive),
    },
    ...MOCK_INTEGRATIONS.map((integration) => ({ ...integration, connected: false })),
  ].filter((tile) => {
    if (filter === "connected" && !tile.connected) return false;
    if (filter === "available" && tile.connected) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${tile.name} ${tile.description}`.toLowerCase().includes(needle);
  });

  return (
    <>
      <div className="flex flex-col items-stretch justify-between gap-4 md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Integrations</h1>
          <p className="text-muted-foreground">
            Connect the apps your agents can use. You still choose each agent&apos;s tools one by one.
          </p>
        </div>
        <label className="flex h-10 w-full shrink-0 items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:border-ring md:max-w-[280px]">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations"
            aria-label="Search integrations"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus-visible:shadow-none!"
          />
        </label>
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="self-start">
        <TabsList aria-label="Show">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="connected">Connected · {connectedCount}</TabsTrigger>
          <TabsTrigger value="available">Available</TabsTrigger>
        </TabsList>
      </Tabs>

      {!encryptionReady && (
        <p role="alert" className="rounded-md bg-warning-subtle px-3 py-2 text-body-s text-warning-text">
          TOKEN_ENCRYPTION_KEY isn&apos;t set, so no account can be connected. Add it to .env and restart.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4 max-md:grid-cols-1">
        {tiles.map((tile) =>
          tile.key === "gmail" ? (
            <IntegrationTile
              key="gmail"
              integration={{ ...tile, enabled: Boolean(gmailActive), toolCount: toolCounts.gmail }}
              onEnabledChange={(on) => {
                if (!on && gmailActive) setConfirming(gmailActive);
              }}
              action={
                canConnect ? (
                  <Link href={GMAIL_CONNECT} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {gmailBroken ? "Reconnect" : "Connect"}
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled title="Google OAuth isn't configured in .env">
                    Connect
                  </Button>
                )
              }
              footer={
                gmailActive ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="run" title={`Connected as ${gmailActive.accountLabel}`}>
                      Connected
                    </Badge>
                    <span className="text-caption font-medium text-muted-foreground">
                      {toolCounts.gmail} tools
                    </span>
                  </div>
                ) : gmailBroken ? (
                  <Badge variant="warn">
                    {gmailBroken.status === "revoked" ? "Reconnect needed" : "Expired"}
                  </Badge>
                ) : undefined
              }
            />
          ) : (
            <IntegrationTile
              key={tile.key}
              integration={tile}
              action={
                // TODO(backend): see MOCK_INTEGRATIONS in lib/mock-data.ts.
                <Button variant="outline" size="sm" disabled title="Coming soon">
                  Connect
                </Button>
              }
            />
          ),
        )}
      </div>
      {tiles.length === 0 && <p className="text-center text-body-s text-muted-foreground">No apps match.</p>}

      <p className="pt-2 text-center text-body-s text-muted-foreground">
        Missing an app?{" "}
        <Link href="/workspace/settings#help" className="text-brand-text hover:underline">
          Request an integration
        </Link>
      </p>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Unplug />
            </AlertDialogMedia>
            <AlertDialogTitle>Disconnect {confirming?.accountLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Omnix will revoke its access and delete the stored token. Any agent using this account
              loses those tools until you connect it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isWorking}
              onClick={() => confirming && disconnect(confirming)}
            >
              {isWorking && <Loader2 className="animate-spin" />}
              {isWorking ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
