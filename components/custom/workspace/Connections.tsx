"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Mail, Plug, TriangleAlert, Unplug } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { disconnectAccount } from "@/app/workspace/integrations/actions";
import type { SafeConnection } from "@/lib/integrations/connections";

/** What a provider is called and what it can do, for the "available" list. */
const PROVIDERS = [
  {
    id: "gmail",
    name: "Gmail",
    icon: Mail,
    description: "Let an agent search and read your email, write drafts, and send with your approval.",
    /** A GET that redirects, so connecting is a plain link. */
    connectHref: "/api/connections/gmail/start?returnTo=/workspace/integrations",
  },
];

type Props = {
  connections: SafeConnection[];
  /** False when the Google client id and secret aren't configured yet. */
  googleReady: boolean;
  /** Set when the token-encryption key is missing: no token can be stored at all. */
  encryptionReady: boolean;
};

export default function Connections({ connections, googleReady, encryptionReady }: Props) {
  const [confirming, setConfirming] = useState<SafeConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, startWorking] = useTransition();

  const disconnect = (connection: SafeConnection) => {
    setError(null);
    startWorking(async () => {
      const result = await disconnectAccount(connection.id);
      setConfirming(null);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <>
      {error && (
        <p role="alert" className="mb-6 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Connected accounts
        </h2>

        {connections.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing connected yet. Connect an account below, then switch its tools on in an
            agent&apos;s settings.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {connections.map((connection) => {
              const provider = PROVIDERS.find((entry) => entry.id === connection.provider);
              const Icon = provider?.icon ?? Plug;
              return (
                <li key={connection.id} className="flex items-center gap-3 px-4 py-3.5">
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{connection.accountLabel}</span>
                      {connection.status === "active" ? (
                        <Badge variant="secondary">{provider?.name ?? connection.provider}</Badge>
                      ) : (
                        <Badge variant="destructive">
                          {connection.status === "revoked" ? "Reconnect needed" : "Expired"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Connected {formatDistanceToNow(new Date(connection.createdAt), { addSuffix: true })}
                      {" · "}
                      {describeScopes(connection.scopes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {connection.status !== "active" && provider && (
                      <Button variant="outline" size="sm" nativeButton={false} render={<a href={provider.connectHref} />}>
                        Reconnect
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isWorking}
                      onClick={() => setConfirming(connection)}
                    >
                      <Unplug />
                      Disconnect
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Available
        </h2>

        {!encryptionReady && (
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              TOKEN_ENCRYPTION_KEY isn&apos;t set, so no account can be stored yet. Add it to{" "}
              <code>.env</code> and restart the dev server.
            </span>
          </p>
        )}

        <ul className="grid gap-3 sm:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const existing = connections.filter((entry) => entry.provider === provider.id);
            const blocked = !googleReady || !encryptionReady;
            return (
              <li key={provider.id} className="flex flex-col rounded-xl border p-4">
                <div className="flex items-center gap-2.5">
                  <provider.icon className="size-5 text-muted-foreground" />
                  <span className="font-medium">{provider.name}</span>
                </div>
                <p className="mt-1.5 flex-1 text-sm text-muted-foreground">{provider.description}</p>
                <div className="mt-4">
                  <Button
                    size="sm"
                    disabled={blocked}
                    nativeButton={blocked}
                    render={blocked ? undefined : <a href={provider.connectHref} />}
                  >
                    <Plug />
                    {existing.length > 0 ? "Connect another account" : `Connect ${provider.name}`}
                  </Button>
                  {!googleReady && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in <code>.env</code> first.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-sm text-muted-foreground">
          Slack, Notion and Jira arrive in Phase 5, through their own MCP servers.
        </p>
      </section>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
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
              {isWorking ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Turns Google's scope URLs into something a person can read. What matters to the user is
 * whether an agent can only look, or also write and send.
 */
function describeScopes(scopes: string[]) {
  const canRead = scopes.some((scope) => scope.includes("gmail.readonly"));
  const canWrite = scopes.some((scope) => /gmail\.(compose|send|modify)/.test(scope));

  if (canRead && canWrite) return "Can read, draft and send";
  if (canRead) return "Can read only";
  if (canWrite) return "Can draft and send only";
  return "No mailbox permissions granted";
}
