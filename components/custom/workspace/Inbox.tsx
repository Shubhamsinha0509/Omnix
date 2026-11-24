"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, isToday, isYesterday } from "date-fns";
import { Filter, Inbox as InboxIcon, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markEverythingRead, markNotificationRead } from "@/app/workspace/inbox/actions";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/agent/events";
import { cn } from "@/lib/utils";
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

/** "2m", "9:00", "Yesterday", "Nov 18" — list times (`.cap.sub`). */
function listTime(date: Date) {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (isToday(date)) return format(date, "H:mm");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

const dayOf = (date: Date) => (isToday(date) ? "Today" : isYesterday(date) ? "Yesterday" : "Earlier");

/** First line of a Markdown body, as a plain preview. */
function preview(body: string) {
  const line = body.split("\n").find((text) => text.replace(/[#>*_`|\-\s]/g, "").length > 0) ?? "";
  return line.replace(/[#>*_`|]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The inbox (14-inbox): what agents did while the user wasn't watching, and anything a
 * background run is waiting to be allowed to do — a list beside the selected item.
 *
 * A result's body is the agent's own words, rendered as Markdown — the same fixed set of
 * tags as a chat reply, no raw HTML (D19), because the words may be quoting an email the
 * agent read.
 */
export default function Inbox({ items }: { items: InboxView[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [, startAction] = useTransition();

  const agents = [
    ...new Map(items.filter((item) => item.agentId).map((item) => [item.agentId!, item.agentName ?? "Agent"])),
  ];
  const shown = items.filter((item) => !agentFilter || item.agentId === agentFilter);
  // A decision waiting on the user stays pinned above whatever is open (14-inbox); the
  // pane opens on the newest report.
  const pinned = shown.find((item) => item.approvalState === "pending" && item.approval) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(
    shown.find((item) => !item.approval)?.id ?? shown[0]?.id ?? null,
  );
  const selected = shown.find((item) => item.id === selectedId) ?? shown[0] ?? null;
  const card = selected?.approval ? selected : pinned;

  const open = (item: InboxView) => {
    setSelectedId(item.id);
    if (item.unread && item.kind !== "approval_request") {
      startAction(async () => void (await markNotificationRead(item.id)));
    }
  };

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

  const groups = new Map<string, InboxView[]>();
  for (const item of shown) {
    const day = dayOf(new Date(item.createdAt));
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Inbox</h1>
        <p className="text-muted-foreground">Reports and requests from your agents.</p>
      </div>
      <div className="flex gap-2">
        {items.some((item) => item.unread) && (
          <Button size="sm" variant="ghost" onClick={() => startAction(async () => void (await markEverythingRead()))}>
            Mark all as read
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
            <Filter />
            {agentFilter ? (agents.find(([id]) => id === agentFilter)?.[1] ?? "Agent") : "All agents"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setAgentFilter(null)}>All agents</DropdownMenuItem>
              {agents.map(([id, name]) => (
                <DropdownMenuItem key={id} onClick={() => setAgentFilter(id)}>
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center gap-3 rounded-lg border-[1.5px] border-dashed border-input px-6 py-16 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <h2 className="text-h2 font-semibold">Nothing here yet</h2>
          <p className="max-w-sm text-muted-foreground">
            When one of your agents finishes a task — or needs you to approve something it wants to do —
            it turns up here.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start">
        {/* The list */}
        <div className="divide-y overflow-hidden rounded-lg border bg-card md:w-[380px] md:shrink-0">
          {[...groups].map(([day, dayItems]) => (
            <div key={day} className="divide-y">
              <div className="bg-muted px-4 py-2.5 text-caption font-medium text-muted-foreground">{day}</div>
              {dayItems.map((item) => {
                const isSelected = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => open(item)}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left text-foreground transition-colors hover:bg-muted/60",
                      isSelected && "bg-accent hover:bg-accent",
                    )}
                  >
                    <span className="mt-2 flex w-2 shrink-0">
                      {item.unread && (
                        <span className="size-2 rounded-full bg-brand" aria-label="Unread" />
                      )}
                    </span>
                    <span className="size-8 shrink-0">
                      {item.agentAvatarSeed ? (
                        <AgentAvatar seed={item.agentAvatarSeed} name="" />
                      ) : (
                        <InboxIcon className="size-5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="flex-1 truncate text-caption font-medium text-muted-foreground">
                          {item.agentName ?? "Omnix"}
                        </span>
                        <span className="text-caption font-medium text-muted-foreground">
                          {listTime(new Date(item.createdAt))}
                        </span>
                      </span>
                      <span className={item.unread ? "font-semibold" : "font-medium"}>
                        {item.kind === "task_failed" ? "Run failed" : item.title}
                      </span>
                      <span className="truncate text-body-s text-muted-foreground">
                        {item.approval ? item.approval.summary : preview(item.body)}
                      </span>
                      {item.approvalState === "pending" && (
                        <Badge variant="warn" className="mt-1">Needs approval</Badge>
                      )}
                      {item.kind === "task_failed" && (
                        <Badge variant="err" className="mt-1">Failed</Badge>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* The selected item */}
        {selected && (
          <article className="flex min-w-0 flex-1 flex-col gap-5 rounded-lg border bg-card p-7 shadow-sm">
            {card?.approval && (
              <ApprovalCard
                request={card.approval}
                state={deciding === card.approval.id ? "deciding" : (card.approvalState ?? "pending")}
                busy={deciding !== null}
                onDecide={(decision) => void decide(card, decision)}
              />
            )}
            <div className="flex items-center gap-3">
              {selected.agentAvatarSeed && (
                <span className="size-10 shrink-0">
                  <AgentAvatar seed={selected.agentAvatarSeed} name="" />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="text-h2 font-semibold">{selected.title}</h2>
                <span className="text-body-s text-muted-foreground">
                  {selected.agentName ?? "Omnix"} ·{" "}
                  {format(new Date(selected.createdAt), isToday(new Date(selected.createdAt)) ? "'today at' h:mm a" : "MMM d 'at' h:mm a")}
                  {selected.taskName ? ` · ${selected.taskName}` : " · scheduled run"}
                </span>
              </div>
            </div>
            {selected.body && <Markdown content={selected.body} />}
            <div className="flex flex-wrap gap-2">
              {selected.agentId && (
                <Link
                  href={`/workspace/agent/${selected.agentId}?new=1`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <MessageSquare />
                  Ask a follow-up
                </Link>
              )}
              {selected.runId && selected.agentId && (
                <Link
                  href={`/workspace/agent/${selected.agentId}/runs/${selected.runId}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  See the run
                </Link>
              )}
              {selected.unread && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startAction(async () => void (await markNotificationRead(selected.id)))}
                >
                  Mark as read
                </Button>
              )}
            </div>
          </article>
        )}
      </div>
    </>
  );
}
