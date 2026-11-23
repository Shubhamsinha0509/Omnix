"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Square, TriangleAlert, X } from "lucide-react";

import { RunStepRow, Spinner, type RunStepState } from "@/components/custom/design/RunStepRow";
import type { SandboxView } from "@/lib/sandbox";
import type { ChatMessage } from "./AgentChat";
import VmCard from "./VmCard";

/**
 * The run beside the chat (design/reference/21-chat-run-panel.html): what the agent is
 * doing for the current turn, step by step, on the dark run panel from 13-live-run.
 *
 * It is drawn from the chat's own stream — the same activity events the tool pill shows —
 * so it is live without polling. The saved record of every run stays on the runs page.
 */

type Row = { key: string; label: string; state: RunStepState; at: number | null };

/** The steps of one reply, in the order they happened. */
function rowsFor(reply: ChatMessage): Row[] {
  const times = reply.times ?? {};
  const rows: Row[] = (reply.activity ?? []).map((item) => ({
    key: item.id,
    label: item.detail ? `${item.label} · ${item.detail}` : item.label,
    state: item.status === "running" ? "current" : item.status === "error" ? "failed" : "done",
    at: times[item.id] ?? null,
  }));

  const busy = rows.some((row) => row.state === "current");
  if (reply.approval) {
    const waiting = reply.approvalState === "pending" || reply.approvalState === "deciding";
    rows.push({
      key: "approval",
      label: waiting ? `Waiting for your approval: ${reply.approval.label}` : `Approval ${reply.approvalState}`,
      state: waiting ? "current" : reply.approvalState === "approved" ? "done" : "failed",
      at: times.approval ?? null,
    });
  } else if (reply.pending && !busy) {
    rows.push({
      key: "reply",
      label: reply.content ? "Writing the reply…" : "Thinking…",
      state: "current",
      at: times.reply ?? null,
    });
  } else if (reply.content) {
    rows.push({ key: "reply", label: "Wrote the reply", state: "done", at: times.reply ?? null });
  }
  return rows;
}

type Status = "working" | "waiting" | "done" | "stopped";

function statusOf(reply: ChatMessage): Status {
  if (reply.approval && (reply.approvalState === "pending" || reply.approvalState === "deciding")) return "waiting";
  if (reply.pending) return "working";
  return reply.content ? "done" : "stopped";
}

/** "00:01:24" */
function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

/** "0:04" since the run started. */
function offset(from: number, at: number | null) {
  if (at === null) return null;
  const seconds = Math.max(0, Math.round((at - from) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Each badge in light mode, then `dark:` for the dark panel. */
const BADGE: Record<Status, { label: string; className: string; dot: string }> = {
  working: {
    label: "Live",
    className: "bg-accent text-accent-foreground dark:bg-[#7C83F5]/20 dark:text-[#C7CBFE]",
    dot: "bg-[#7C83F5]",
  },
  waiting: {
    label: "Waiting for you",
    className: "bg-warning-subtle text-warning-text dark:bg-warning/15 dark:text-[#FCD34D]",
    dot: "bg-[#F59E0B]",
  },
  done: {
    label: "Done",
    className: "bg-[#16A34A]/10 text-[#15803D] dark:bg-[#22C55E]/15 dark:text-[#4ADE80]",
    dot: "bg-[#22C55E]",
  },
  stopped: {
    label: "Stopped",
    className: "bg-muted text-run-panel-muted dark:bg-white/10",
    dot: "bg-run-panel-muted",
  },
};
const IDLE = { label: "Idle", className: "bg-muted text-run-panel-muted dark:bg-white/[0.06]", dot: "bg-run-panel-muted" };

/** What a run looks like before there is one: the shape of the steps, not yet started. */
const PREVIEW = ["Reads your message", "Uses its tools", "Writes the reply"];

export default function ChatRunPanel({
  agentId,
  run,
  vm,
  onStop,
  onClose,
}: {
  agentId: string;
  /** The agent's VM as the page found it, and whether E2B is configured at all. */
  vm: { ready: boolean; initial: SandboxView };
  /** The reply this panel follows: the latest one sent from this page, or null before any. */
  run: ChatMessage | null;
  onStop: () => void;
  onClose: () => void;
}) {
  const status = run ? statusOf(run) : null;
  const live = status === "working" || status === "waiting";

  // Tick once a second while the run is live, so the clock moves.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  const startedAt = run?.startedAt ?? null;
  const elapsed = startedAt ? clock((live ? now : (run?.finishedAt ?? now)) - startedAt) : "00:00:00";
  const rows = run ? rowsFor(run) : [];
  /**
   * Changes whenever the agent starts or finishes a VM tool step, so the VM card re-checks
   * at once: the agent may just have started or resumed the VM itself.
   */
  const vmNudge = (run?.activity ?? [])
    .filter((item) => item.tool.startsWith("sandbox"))
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  const badge = status ? BADGE[status] : null;

  return (
    <section
      aria-label="Run"
      // Docked flush like the sidebar; scrolls without showing a scrollbar.
      className="run-panel-themed flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-run-panel px-5 pb-5 text-run-panel-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* Header: which run, its state, how long, and the way to the full record. Same 64px
          as the chat header, so the two header lines meet; stays put while the panel scrolls. */}
      <div className="sticky top-0 z-10 -mx-5 mb-3 flex h-16 shrink-0 items-center gap-2.5 border-b border-border bg-run-panel px-5 dark:border-white/[0.08]">
        <span className="font-semibold">{run ? "This run" : "Run"}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium ${(badge ?? IDLE).className}`}>
          <span className={`size-2 rounded-full ${(badge ?? IDLE).dot}`} />
          {(badge ?? IDLE).label}
        </span>
        <span className="flex-1" />
        {run && <span className="font-mono text-caption text-run-panel-muted tabular-nums">{elapsed}</span>}
        <Link
          href={`/workspace/agent/${agentId}/runs`}
          aria-label="All runs"
          title="All runs"
          className="flex size-8 items-center justify-center rounded-[10px] text-run-panel-muted hover:bg-run-panel-raised hover:text-run-panel-foreground"
        >
          <ExternalLink className="size-4" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide run panel"
          title="Hide run panel"
          className="flex size-8 cursor-pointer items-center justify-center rounded-[10px] text-run-panel-muted hover:bg-run-panel-raised hover:text-run-panel-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <VmCard agentId={agentId} ready={vm.ready} initial={vm.initial} nudge={vmNudge} />

      <p className="px-1 pt-2 pb-1 text-caption font-medium text-run-panel-muted">Steps</p>
      {rows.length === 0 ? (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 opacity-70">
          {PREVIEW.map((label) => (
            <RunStepRow key={label} state="pending" label={label} time={null} />
          ))}
        </ol>
      ) : (
        <ol aria-live="polite" className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((row) => (
            <RunStepRow
              key={row.key}
              state={row.state}
              label={row.label}
              time={startedAt ? offset(startedAt, row.at) : null}
            />
          ))}
        </ol>
      )}

      {run?.notes?.map((note, index) => (
        <p key={index} className="mt-1 flex gap-2 rounded-md bg-run-panel-raised px-3 py-2 text-body-s text-run-panel-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text dark:text-[#FCD34D]" />
          {note}
        </p>
      ))}

      <div className="flex-1" />

      {/* Footer: what is happening now, and the one control that works today */}
      {!run && (
        <div className="mt-2 flex min-h-[52px] items-center gap-3 rounded-lg bg-run-panel-raised py-2 pr-2 pl-4">
          <span className="size-2 shrink-0 rounded-full bg-run-panel-muted" />
          <span className="flex-1 text-body-s text-run-panel-muted">
            Send a message to start a run
          </span>
        </div>
      )}
      {run && (
        <div className="mt-2 flex min-h-[52px] items-center gap-3 rounded-lg bg-run-panel-raised py-2 pr-2 pl-4">
          {status === "working" ? (
            <>
              <Spinner />
              <span className="flex-1 text-run-panel-muted">Agent is working…</span>
              <button
                type="button"
                onClick={onStop}
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-destructive/45 px-3 font-medium text-destructive hover:bg-destructive/5 dark:border-[#F87171]/45 dark:text-[#F87171] dark:hover:bg-white/5"
              >
                <Square className="size-3.5 fill-current" />
                Stop
              </button>
            </>
          ) : status === "waiting" ? (
            <>
              <Spinner />
              <span className="flex-1 text-run-panel-muted">Decide the approval in the chat to carry on.</span>
            </>
          ) : status === "done" ? (
            <>
              <Check className="size-4 text-[#22C55E]" />
              <span className="flex-1 text-run-panel-muted">Run finished in {elapsed}</span>
            </>
          ) : (
            <>
              <Square className="size-3.5 fill-current text-run-panel-muted" />
              <span className="flex-1 text-run-panel-muted">Run stopped</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

