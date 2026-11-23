"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, Monitor, MousePointer2, Pause, Play, Square, TriangleAlert, X } from "lucide-react";

import { getVm, openVmScreen, pauseVm, startVm, stopVm } from "@/app/workspace/agent/[id]/vm/actions";
import { Spinner } from "@/components/custom/design/RunStepRow";
import type { SandboxScreen, SandboxView } from "@/lib/sandbox";
import { cn } from "@/lib/utils";

/**
 * The agent's own VM in the run panel (design/reference/21-chat-run-panel.html): its state,
 * the controls, and its live screen. The work is in lib/sandbox; this only asks and shows.
 *
 * Colors come in pairs, light first and then `dark:`, because the panel follows the theme.
 */

type Props = {
  agentId: string;
  /** False when E2B_API_KEY isn't set: everything shows, nothing starts. */
  ready: boolean;
  /** The VM as the page found it. */
  initial: SandboxView;
};

/** "00:03:12" */
function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const STATUS: Record<SandboxView["status"], { label: string; className: string }> = {
  stopped: { label: "Off", className: "text-run-panel-muted" },
  starting: { label: "Starting…", className: "text-accent-foreground dark:text-[#C7CBFE]" },
  running: { label: "Running", className: "text-[#15803D] dark:text-[#4ADE80]" },
  pausing: { label: "Pausing…", className: "text-warning-text dark:text-[#FCD34D]" },
  paused: { label: "Paused · files kept", className: "text-warning-text dark:text-[#FCD34D]" },
  stopping: { label: "Stopping…", className: "text-run-panel-muted" },
  error: { label: "Didn't start", className: "text-destructive dark:text-[#F87171]" },
};

/** The in-between states: someone (this tab or another) is changing the VM right now. */
const MOVING: SandboxView["status"][] = ["starting", "pausing", "stopping"];

const BUTTON =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-3 font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";
const GO = cn(BUTTON, "bg-[#16A34A] font-semibold text-white hover:bg-[#15803D]");
const OUTLINE = cn(
  BUTTON,
  "border border-input text-run-panel-foreground hover:bg-muted dark:border-white/[0.14] dark:hover:bg-white/[0.06]",
);
const DANGER = cn(
  BUTTON,
  "border border-destructive/45 text-destructive hover:bg-destructive/5 dark:border-[#F87171]/45 dark:text-[#F87171] dark:hover:bg-white/5",
);

export default function VmCard({ agentId, ready, initial }: Props) {
  const [vm, setVm] = useState<SandboxView>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial.error);
  /**
   * Stop deletes the VM's files, so it asks first, in a row that stays until answered.
   * (A button that changed its own label and quietly reverted read as "Stop did nothing".)
   */
  const [confirmStop, setConfirmStop] = useState(false);

  const [screen, setScreen] = useState<SandboxScreen | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [control, setControl] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const opening = useRef(false);

  const [now, setNow] = useState(() => Date.now());
  const running = vm.status === "running";

  /** Runs one action and takes whatever state the server reports back. */
  const act = async (action: (id: string) => Promise<{ error: string } | { vm: SandboxView }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action(agentId);
      if ("error" in result) setError(result.error);
      else setVm(result.vm);
      if ("error" in result) {
        const fresh = await getVm(agentId);
        if ("vm" in fresh) setVm(fresh.vm);
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  };

  const refresh = useCallback(async () => {
    try {
      const result = await getVm(agentId);
      if ("vm" in result) setVm(result.vm);
    } catch {
      // Offline for a moment: the next check will catch up.
    }
  }, [agentId]);

  // Tick the uptime once a second while it runs.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  // Follow changes we didn't make: another tab mid-change (quickly), and E2B pausing an
  // idle VM on its own (just after the time it was due).
  useEffect(() => {
    if (MOVING.includes(vm.status) && !busy) {
      const timer = window.setTimeout(refresh, 2000);
      return () => window.clearTimeout(timer);
    }
    if (running && vm.expiresAt) {
      const due = new Date(vm.expiresAt).getTime() - Date.now() + 5000;
      const timer = window.setTimeout(refresh, Math.max(5000, Math.min(due, 60_000)));
      return () => window.clearTimeout(timer);
    }
  }, [vm, busy, running, refresh]);

  // The screen belongs to a running VM: open it when it starts, forget it when it stops.
  // Clearing the old links on the way out happens below, while rendering.
  useEffect(() => {
    if (!running || screen || screenError || opening.current) return;
    opening.current = true;
    openVmScreen(agentId)
      .then((result) => {
        if ("error" in result) setScreenError(result.error);
        else {
          setScreen(result.screen);
          setVm(result.vm);
        }
      })
      .catch(() => setScreenError("Couldn't open the VM's screen. Please try again."))
      .finally(() => {
        opening.current = false;
      });
  }, [running, screen, screenError, agentId]);

  const [screenFor, setScreenFor] = useState(running);
  if (running !== screenFor) {
    setScreenFor(running);
    if (!running) {
      setScreen(null);
      setScreenError(null);
      setControl(false);
      setExpanded(false);
    }
  }

  // Esc closes the expanded screen.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const status = STATUS[vm.status];
  const uptime = running && vm.runningSince ? clock((now - new Date(vm.runningSince).getTime()) / 1000) : null;
  const pausesIn =
    running && vm.expiresAt ? Math.max(0, Math.ceil((new Date(vm.expiresAt).getTime() - now) / 60_000)) : null;
  const moving = MOVING.includes(vm.status) || busy;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-run-panel-raised p-4">
      {/* Title, state, uptime */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            running
              ? "bg-[#16A34A]/10 text-[#15803D] dark:bg-[#22C55E]/15 dark:text-[#4ADE80]"
              : "bg-accent text-brand dark:bg-[#7C83F5]/20 dark:text-[#A5ABFB]",
          )}
        >
          <Monitor className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">Isolated VM</span>
          <span className={cn("inline-flex items-center gap-1.5 text-caption font-medium", status.className)}>
            {MOVING.includes(vm.status) ? <Spinner className="size-3 border-2" /> : <span className="size-2 rounded-full bg-current" />}
            {status.label}
          </span>
        </div>
        {uptime && (
          <span className="font-mono text-caption text-run-panel-muted tabular-nums" title="Running for">
            {uptime}
          </span>
        )}
      </div>

      {/* What it is, or what is happening to it */}
      {!ready ? (
        <p className="text-caption text-run-panel-muted">
          VMs aren&apos;t set up yet: add E2B_API_KEY to .env and restart the dev server.
        </p>
      ) : vm.status === "stopped" || vm.status === "error" ? (
        <p className="text-caption text-run-panel-muted">
          A private sandbox where this agent can run code, use a browser and keep files. Starts in a few
          seconds. Billed per second while running.
        </p>
      ) : vm.status === "paused" ? (
        <p className="text-caption text-run-panel-muted">
          Paused VMs keep their files and cost nothing. Resume picks up where it left off.
        </p>
      ) : running && pausesIn !== null ? (
        <p className="text-caption text-run-panel-muted">
          Pauses by itself after {pausesIn <= 1 ? "about a minute" : `${pausesIn} minutes`} without use.
        </p>
      ) : null}

      {error && (
        <p role="alert" className="flex items-start gap-2 text-caption text-destructive dark:text-[#F87171]">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {/* Live screen */}
      {ready && (
        <LiveScreen
          status={vm.status}
          screen={screen}
          screenError={screenError}
          control={control}
          expanded={expanded}
          onControl={() => setControl((on) => !on)}
          onExpand={() => setExpanded((on) => !on)}
          onRetry={() => setScreenError(null)}
        />
      )}

      {/* Controls, or the question Stop asks first */}
      {confirmStop && (running || vm.status === "paused") ? (
        <div
          role="alertdialog"
          aria-label="Stop the VM"
          className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 dark:border-[#F87171]/30 dark:bg-[#F87171]/10"
        >
          <p className="text-body-s">
            <span className="font-semibold">Stop the VM?</span>{" "}
            <span className="text-run-panel-muted">Everything on it will be deleted. To keep its files, pause it instead.</span>
          </p>
          <div className="flex gap-2">
            <button type="button" className={cn(OUTLINE, "flex-1")} disabled={busy} onClick={() => setConfirmStop(false)}>
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              className={cn(BUTTON, "flex-1 bg-destructive font-semibold text-white hover:bg-destructive/90")}
              disabled={busy}
              onClick={() => void act(stopVm)}
            >
              {busy ? <Spinner className="border-white/30 border-t-white" /> : <Square className="size-3.5 fill-current" />}
              {busy ? "Stopping" : "Stop and delete"}
            </button>
          </div>
        </div>
      ) : (
      <div className="flex gap-2">
        {vm.status === "stopped" || vm.status === "error" ? (
          <button type="button" className={cn(GO, "flex-1")} disabled={!ready || moving} onClick={() => void act(startVm)}>
            {busy ? <Spinner className="border-white/30 border-t-white" /> : <Play className="size-4 fill-current" />}
            {busy ? "Starting VM" : "Start VM"}
          </button>
        ) : vm.status === "paused" ? (
          <button type="button" className={cn(GO, "flex-1")} disabled={moving} onClick={() => void act(startVm)}>
            {busy ? <Spinner className="border-white/30 border-t-white" /> : <Play className="size-4 fill-current" />}
            {busy ? "Resuming" : "Resume"}
          </button>
        ) : running ? (
          <button type="button" className={cn(OUTLINE, "flex-1")} disabled={moving} onClick={() => void act(pauseVm)}>
            <Pause className="size-4" />
            Pause
          </button>
        ) : (
          <button type="button" className={cn(OUTLINE, "flex-1")} disabled>
            <Spinner />
            {status.label}
          </button>
        )}

        {(running || vm.status === "paused") && (
          <button type="button" className={cn(DANGER, "flex-1")} disabled={moving} onClick={() => setConfirmStop(true)}>
            <Square className="size-3.5 fill-current" />
            Stop VM
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/** The VM's desktop, live. View-only until the user takes control. */
function LiveScreen({
  status,
  screen,
  screenError,
  control,
  expanded,
  onControl,
  onExpand,
  onRetry,
}: {
  status: SandboxView["status"];
  screen: SandboxScreen | null;
  screenError: string | null;
  control: boolean;
  expanded: boolean;
  onControl: () => void;
  onExpand: () => void;
  onRetry: () => void;
}) {
  const running = status === "running";

  const frame = (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border bg-card dark:bg-[#08091A]",
        control ? "border-[#F59E0B]" : "border-border dark:border-white/[0.08]",
        expanded ? "min-h-0 flex-1" : "aspect-[16/10] max-w-full",
      )}
    >
      {running && screen ? (
        <iframe
          // A new src per mode: the viewer reconnects with or without input.
          key={control ? "control" : "view"}
          src={control ? screen.controlUrl : screen.viewUrl}
          title="The VM's live screen"
          className="absolute inset-0 size-full border-0"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-caption text-run-panel-muted">
          {running && screenError ? (
            <>
              <TriangleAlert className="size-5 text-destructive dark:text-[#F87171]" />
              {screenError}
              <button type="button" onClick={onRetry} className="cursor-pointer font-medium text-brand-text underline-offset-2 hover:underline dark:text-[#A5ABFB]">
                Try again
              </button>
            </>
          ) : running || status === "starting" ? (
            <>
              <Spinner />
              Connecting to the screen…
            </>
          ) : (
            <>
              <Monitor className="size-5" />
              {status === "paused" ? "Resume the VM to see its screen" : "The VM’s screen appears here while it runs"}
            </>
          )}
        </div>
      )}
    </div>
  );

  const bar = (
    <div className="flex items-center gap-2">
      <span className="text-caption font-medium text-run-panel-muted">Live screen</span>
      {running && screen && (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-caption font-medium",
            control
              ? "bg-warning-subtle text-warning-text dark:bg-warning/15 dark:text-[#FCD34D]"
              : "bg-muted text-run-panel-muted dark:bg-white/[0.06]",
          )}
        >
          {control ? "You’re in control" : "View only"}
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onControl}
        disabled={!running || !screen}
        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-input px-2.5 text-caption font-medium text-run-panel-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.14] dark:hover:bg-white/[0.06]"
      >
        <MousePointer2 className="size-3.5" />
        {control ? "Give back" : "Take control"}
      </button>
      <button
        type="button"
        onClick={onExpand}
        disabled={!running || !screen}
        aria-label={expanded ? "Close the expanded screen" : "Expand the screen"}
        title={expanded ? "Close (Esc)" : "Expand"}
        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-run-panel-muted hover:bg-muted hover:text-run-panel-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06]"
      >
        {expanded ? <X className="size-4" /> : <Expand className="size-4" />}
      </button>
    </div>
  );

  if (expanded) {
    return (
      <>
        {/* Keeps the card's layout while the screen is shown large. */}
        <div className="flex aspect-[16/10] max-w-full items-center justify-center rounded-md border border-dashed border-border text-caption text-run-panel-muted dark:border-white/[0.14]">
          Shown expanded
        </div>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="The VM's live screen"
          className="run-panel-themed fixed inset-4 z-50 flex flex-col gap-3 rounded-xl bg-run-panel p-4 text-run-panel-foreground shadow-[0_0_0_100vmax_rgba(8,9,26,0.6)] md:inset-8"
        >
          {bar}
          {frame}
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {bar}
      {frame}
    </div>
  );
}
