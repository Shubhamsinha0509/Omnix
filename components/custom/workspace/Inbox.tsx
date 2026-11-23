"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { CheckCheck, Inbox as InboxIcon, ShieldCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markEverythingRead, markNotificationRead } from "@/app/workspace/inbox/actions";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/agent/events";
import { AgentAvatar } from "./AgentAvatar";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";

/** One inbox entry as the page hands it over. */
export type InboxView = {
  id: string;
  kind: "task_result" | "task_failed" | "approval_request";
  title: string;
  body: string;
  agentId: string | null;
  agentName: string | null;
  agentAvatarSeed: string | null;
  taskName: string | null;
  runId: string | null;
  unread: boolean;
  createdAt: string;
  /** Present for an `approval_request`: the card to draw, and what became of it. */
  approval: ApprovalRequest | null;
  approvalState: "pending" | ApprovalDecision | null;
};

/**
 * The inbox: what the user's agents did while they weren't watching, and anything a
 * background run is waiting to be allowed to do.
 *
 * A result's body is the agent's own words, rendered as Markdown — the same fixed set of
 * tags as a chat reply, no raw HTML (D19), because the words may be quoting an email the
 * agent read.
 */
export default function Inbox({ items }: { items: InboxView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [, startAction] = useTransition();

  const unread = items.filter((item) => item.unread).length;

  /**
   * Answers a card. The run itself is still parked on this decision in Inngest, so the
   * agent carries on from here — this request only records the answer and tells it (D41).
   */
  const decide = async (item: InboxView, decision: "approve" | "reject") => {
    if (!item.approval) return;
    setError(null);
    setDeciding(item.approval.id);

    try {
      const response = await fetch(`/api/approvals/${item.approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That decision couldn't be saved. Please try again.");
      } else {
        // The agent picks it up in the background; the row is already decided.
        startAction(() => {
          void markNotificationRead(item.id);
          router.refresh();
        });
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {unread > 0 ? `${unread} unread` : "Nothing unread"}
        </p>
        {unread > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => startAction(async () => void (await markEverythingRead()))}
          >
            <CheckCheck />
            Mark all as read
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <h2 className="font-semibold">Nothing here yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            When one of your agents finishes a task — or needs you to approve something it wants to
            do — it turns up here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border p-4 ${item.unread ? "border-primary/30 bg-primary/[0.03]" : ""}`}
            >
              <div className="flex items-start gap-3">
                {item.agentAvatarSeed ? (
                  <div className="mt-0.5 size-7 shrink-0">
                    <AgentAvatar seed={item.agentAvatarSeed} name={item.agentName ?? "Agent"} />
                  </div>
                ) : (
                  <InboxIcon className="mt-1 size-5 shrink-0 text-muted-foreground" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.kind === "approval_request" && (
                      <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />
                    )}
                    {item.kind === "task_failed" && <TriangleAlert className="size-4 text-destructive" />}
                    <span className="font-medium">{item.title}</span>
                    {item.unread && <span className="size-1.5 rounded-full bg-primary" />}
                  </div>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.agentName ?? "Omnix"}
                    {item.taskName ? ` · ${item.taskName}` : ""} ·{" "}
                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                  </p>

                  {item.approval ? (
                    <>
                      <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
                      <ApprovalCard
                        request={item.approval}
                        state={deciding === item.approval.id ? "deciding" : item.approvalState ?? "pending"}
                        busy={deciding !== null}
                        onDecide={(decision) => void decide(item, decision)}
                      />
                    </>
                  ) : (
                    <div className="mt-2">
                      <Markdown content={item.body} />
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    {item.runId && item.agentId && (
                      <Link
                        href={`/workspace/agent/${item.agentId}/runs/${item.runId}`}
                        className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        See the run
                      </Link>
                    )}
                    {item.agentId && (
                      <Link
                        href={`/workspace/agent/${item.agentId}/tasks`}
                        className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        The task
                      </Link>
                    )}
                    {item.unread && (
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        onClick={() => startAction(async () => void (await markNotificationRead(item.id)))}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
