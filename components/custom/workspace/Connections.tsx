"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Search, Unplug } from "lucide-react";

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
import { disconnectAccount, refreshServerTools } from "@/app/workspace/integrations/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import { devOnly } from "@/lib/setup";

/** One app on this page, whether it is built in, an MCP server, or still a picture. */
export type IntegrationView = {
  key: string;
  name: string;
  description: string;
  /** Letter mark and brand colour for the 44px tile. */
  mark: string;
  color: string;
  /** The active account, when there is one. */
  connection: SafeConnection | null;
  /** An account that needs reconnecting — expired, or access revoked. */
  broken: SafeConnection | null;
  toolCount: number;
  /** Where "Connect" goes, or null when it can't be connected here. */
  connectHref: string | null;
  /** Why it can't be connected, shown on the disabled button. */
  disabledReason: string | null;
  /** MCP servers: how fresh the tool list is, and why it is missing. */
  toolsState?: { fetchedAt: string | null; error: string | null; stale: boolean } | null;
  docsUrl?: string;
  beta?: boolean;
  /** True while the app is only a design (lib/mock-data.ts). */
  mock?: boolean;
};

type Props = {
  integrations: IntegrationView[];
  /** Set when the token-encryption key is missing: no token can be stored at all. */
  encryptionReady: boolean;
};

type Filter = "all" | "connected" | "available";

/**
 * Integrations (15-integrations): the apps agents can use. Connecting one gives no agent
 * access by itself — each agent's tools are switched on one by one in its Tools tab.
 *
 * Gmail and the MCP servers are real: Connect runs the account's OAuth flow and switching
 * a tile off disconnects it (after asking). An MCP tile also offers "Refresh tools",
 * because its tools belong to the server and can change without us.
 */
export default function Connections({ integrations, encryptionReady }: Props) {
  const [confirming, setConfirming] = useState<SafeConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [isWorking, startWorking] = useTransition();

  const connectedCount = integrations.filter((integration) => integration.connection).length;

  const disconnect = (connection: SafeConnection) => {
    setError(null);
    startWorking(async () => {
      const result = await disconnectAccount(connection.id);
      setConfirming(null);
      if (result?.error) setError(result.error);
    });
  };

  const refresh = (integration: IntegrationView) => {
    if (!integration.connection) return;
    setError(null);
    setRefreshing(integration.key);
    startWorking(async () => {
      const result = await refreshServerTools(integration.connection!.id);
      setRefreshing(null);
      if (result?.error) setError(`${integration.name}: ${result.error}`);
    });
  };

  const visible = integrations.filter((integration) => {
    const connected = Boolean(integration.connection);
    if (filter === "connected" && !connected) return false;
    if (filter === "available" && connected) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${integration.name} ${integration.description}`.toLowerCase().includes(needle);
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
          {devOnly(
            "TOKEN_ENCRYPTION_KEY isn't set, so no account can be connected. Add it to .env and restart.",
            "Connecting accounts isn't available on this server right now.",
            process.env.NODE_ENV === "production",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4 max-md:grid-cols-1">
        {visible.map((integration) => {
          const active = integration.connection;
          const isRefreshing = refreshing === integration.key;

          return (
            <IntegrationTile
              key={integration.key}
              integration={{
                key: integration.key,
                name: integration.name,
                description: integration.description,
                mark: integration.mark,
                color: integration.color,
                connected: Boolean(active),
                enabled: Boolean(active),
                toolCount: integration.toolCount,
              }}
              onEnabledChange={active ? (on) => !on && setConfirming(active) : undefined}
              action={
                integration.connectHref ? (
                  <Link
                    href={integration.connectHref}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {integration.broken ? "Reconnect" : "Connect"}
                  </Link>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    title={integration.disabledReason ?? undefined}
                  >
                    Connect
                  </Button>
                )
              }
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  {active ? (
                    <>
                      <Badge variant="run" title={`Connected as ${active.accountLabel}`}>
                        Connected
                      </Badge>
                      <span className="text-caption font-medium text-muted-foreground">
                        {integration.toolCount} {integration.toolCount === 1 ? "tool" : "tools"}
                      </span>
                      {integration.toolsState && (
                        <button
                          type="button"
                          onClick={() => refresh(integration)}
                          disabled={isWorking}
                          title={toolsTitle(integration)}
                          className="inline-flex min-h-11 items-center gap-1 text-caption font-medium text-brand-text hover:underline disabled:opacity-60"
                        >
                          {isRefreshing ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                          )}
                          {isRefreshing ? "Refreshing…" : "Refresh tools"}
                        </button>
                      )}
                      {integration.toolsState?.error && (
                        <Badge variant="warn" title={integration.toolsState.error}>
                          Tools unavailable
                        </Badge>
                      )}
                    </>
                  ) : integration.broken ? (
                    <Badge variant="warn">
                      {integration.broken.status === "revoked" ? "Reconnect needed" : "Expired"}
                    </Badge>
                  ) : (
                    <>
                      <span className="text-caption font-medium text-muted-foreground">
                        {integration.mock ? "Coming soon" : "Not connected"}
                      </span>
                      {integration.beta && <Badge variant="warn">Beta</Badge>}
                    </>
                  )}
                </div>
              }
            />
          );
        })}
      </div>
      {visible.length === 0 && <p className="text-center text-body-s text-muted-foreground">No apps match.</p>}

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

/** When the tool list was last read, for the Refresh button's tooltip. */
function toolsTitle(integration: IntegrationView) {
  const state = integration.toolsState;
  if (!state) return undefined;
  if (state.error) return `Last refresh failed: ${state.error}`;
  if (!state.fetchedAt) return "The tool list hasn't been read yet.";
  return `Tool list read ${new Date(state.fetchedAt).toLocaleString()}${state.stale ? " (due a refresh)" : ""}`;
}
