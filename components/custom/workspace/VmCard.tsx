"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, Monitor, MousePointer2, Play, Square, Trash2, TriangleAlert, X } from "lucide-react";

import { getVm, getVmStats, openVmScreen, pauseVm, startVm, stopVm } from "@/app/workspace/agent/[id]/vm/actions";
import { Spinner } from "@/components/custom/design/RunStepRow";
import type { Activity } from "@/lib/agent/events";
import type { SandboxScreen, SandboxStats, SandboxView } from "@/lib/sandbox";
import { cn } from "@/lib/utils";

/** One line of the VM's activity log: a command, a success, a note, or a problem. */
type LogLine = { id: number; kind: "cmd" | "ok" | "info" | "warn"; text: string; at: number };

/** The log keeps this many lines; older ones scroll away. */
const MAX_LOG = 60;

/** "512 MB", "1.2 GB" */
function size(mb: number | null) {
  if (mb === null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/** "3.4 s" */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

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
  /** Changes when the agent uses a VM tool: time to re-check, it may have started the VM. */
  nudge?: string;
  /** The agent's VM steps in the current run, for the activity log. */
  steps?: Activity[];
};

/** "00:03:12" */
function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const STATUS: Record<SandboxView["status"], { label: string; className: string }> = {
  // What the user sees is "Stop" (keep everything) and "Delete" (remove it). Underneath,
  // Stop is E2B's pause and Delete is its kill: "Stop VM" for a kill read as "turn it off".
  stopped: { label: "Off", className: "text-run-panel-muted" },
  starting: { label: "Starting…", className: "text-accent-foreground dark:text-[#C7CBFE]" },
  running: { label: "Running", className: "text-[#15803D] dark:text-[#4ADE80]" },
  pausing: { label: "Stopping…", className: "text-warning-text dark:text-[#FCD34D]" },
  paused: { label: "Stopped · files kept", className: "text-warning-text dark:text-[#FCD34D]" },
  stopping: { label: "Deleting…", className: "text-run-panel-muted" },
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

export default function VmCard({ agentId, ready, initial, nudge, steps = [] }: Props) {
  const [vm, setVmState] = useState<SandboxView>(initial);

  /**
   * The activity log: only what this page actually saw happen, since it was opened. Starts
   * with one line saying what state the VM was found in.
   */
  const [log, setLog] = useState<LogLine[]>(() =>
    initial.status === "running" && initial.runningSince
      ? [{ id: 0, kind: "info", text: `VM running since ${new Date(initial.runningSince).toLocaleTimeString()}`, at: Date.now() }]
      : initial.status === "paused"
        ? [{ id: 0, kind: "info", text: "VM stopped · files and memory kept", at: Date.now() }]
        : [],
  );
  const logId = useRef(1);
  const note = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((lines) => [...lines, { id: logId.current++, kind, text, at: Date.now() }].slice(-MAX_LOG));
  }, []);

  /**
   * Takes a new state from the server. Changes nobody on this page asked for (E2B pausing
   * an idle VM, the agent starting it, another tab) are written to the log here; the ones
   * this page makes are logged by `act` with their timings.
   */
  const current = useRef(initial.status);
  const setVm = useCallback(
    (next: SandboxView, external = false) => {
      const before = current.current;
      current.current = next.status;
      setVmState(next);
      if (!external || before === next.status) return;
      if (next.status === "running" && before !== "starting") note("info", "VM started (by the agent or another tab)");
      else if (next.status === "running") note("ok", "✓ Running");
      else if (next.status === "paused" && before === "running") note("info", "Stopped by itself after 10 idle minutes · files kept");
      else if (next.status === "paused") note("info", "VM stopped · files kept");
      else if (next.status === "stopped") note("info", "VM deleted");
      else if (next.status === "starting") note("cmd", "$ vm start   (started elsewhere)");
    },
    [note],
  );

  const [stats, setStats] = useState<SandboxStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial.error);
  /**
   * Delete removes the VM and its files, so it asks first, in a row that stays until
   * answered. (A button that changed its own label and quietly reverted read as "nothing
   * happened".)
   */
  const [confirmStop, setConfirmStop] = useState(false);

  const [screen, setScreen] = useState<SandboxScreen | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [control, setControl] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const opening = useRef(false);

  const [now, setNow] = useState(() => Date.now());
  const running = vm.status === "running";

  /** Re-reads the VM's state; anything that changed without this page is logged. */
  const refresh = useCallback(async () => {
    try {
      const result = await getVm(agentId);
      if ("vm" in result) setVm(result.vm, true);
    } catch {
      // Offline for a moment: the next check will catch up.
    }
  }, [agentId, setVm]);

  /** What each action is called in the log, and what it says when it worked. */
  const ACTIONS = {
    start: { run: startVm, cmd: "$ vm start", done: (ms: number) => `✓ Running · ready in ${seconds(ms)}` },
    resume: { run: startVm, cmd: "$ vm resume", done: (ms: number) => `✓ Resumed in ${seconds(ms)} · files kept` },
    pause: { run: pauseVm, cmd: "$ vm stop", done: (ms: number) => `✓ Stopped in ${seconds(ms)} · files and memory kept` },
    stop: { run: stopVm, cmd: "$ vm delete", done: () => "✓ Deleted · the VM and its files were removed" },
  } as const;

  /** Runs one action, logs it with its timing, and takes the state the server reports. */
  const act = async (name: keyof typeof ACTIONS) => {
    const action = ACTIONS[name];
    setBusy(true);
    setError(null);
    note("cmd", action.cmd);
    const started = Date.now();
    try {
      const result = await action.run(agentId);
      if ("error" in result) {
        setError(result.error);
        note("warn", result.error);
        const fresh = await getVm(agentId);
        if ("vm" in fresh) setVm(fresh.vm);
      } else {
        setVm(result.vm);
        note("ok", action.done(Date.now() - started));
      }
    } catch (thrown) {
      // A page opened before the app was updated calls server actions that no longer
      // exist; Next says so in the message. Only a reload helps, so say that.
      const stale = /server action/i.test(String((thrown as Error)?.message ?? ""));
      const message = stale
        ? "The app was updated since this page opened. Reload the page and try again."
        : "That didn't go through. Please try again.";
      setError(message);
      note("warn", message);
      // Show what the VM is really doing now, whatever happened to the request.
      void refresh();
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  };

  // CPU, memory and disk while it runs: now, then every 10 s. Kept from the last reading
  // when it stops, but not shown then.
  useEffect(() => {
    if (vm.status !== "running") return;
    let cancelled = false;
    let timer: number | undefined;
    const read = async () => {
      try {
        const result = await getVmStats(agentId);
        if (!cancelled && "stats" in result) setStats(result.stats);
      } catch {
        // A missed reading is fine; the next one comes in 10 s.
      }
      if (!cancelled) timer = window.setTimeout(read, 10_000);
    };
    void read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [vm.status, agentId]);

  // The agent's VM steps, into the log as they start and finish. Done while rendering
  // (React's "adjust state when a prop changes"), keyed on each step's id and status.
  const stepsKey = steps.map((step) => `${step.id}:${step.status}`).join("|");
  const [loggedSteps, setLoggedSteps] = useState<Record<string, Activity["status"]>>({});
  const [stepsSeen, setStepsSeen] = useState("");
  if (stepsKey !== stepsSeen) {
    setStepsSeen(stepsKey);
    const fresh: Omit<LogLine, "id" | "at">[] = [];
    const next = { ...loggedSteps };
    for (const step of steps) {
      if (next[step.id] === step.status) continue;
      if (!next[step.id]) fresh.push({ kind: "cmd", text: `$ agent: ${step.label}${step.detail ? ` · ${step.detail}` : ""}` });
      if (step.status === "done") fresh.push({ kind: "ok", text: "✓ done" });
      if (step.status === "error") fresh.push({ kind: "warn", text: `✗ ${step.detail ?? "failed"}` });
      next[step.id] = step.status;
    }
    setLoggedSteps(next);
    if (fresh.length) {
      setLog((lines) =>
        [...lines, ...fresh.map((line) => ({ ...line, id: logId.current++, at: Date.now() }))].slice(-MAX_LOG),
      );
    }
  }

  // The agent used the VM: check now rather than at the next scheduled look. A short delay
  // folds a burst of step updates into one check.
  useEffect(() => {
    if (!nudge) return;
    const timer = window.setTimeout(refresh, 300);
    return () => window.clearTimeout(timer);
  }, [nudge, refresh]);

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
    const started = Date.now();
    openVmScreen(agentId)
      .then((result) => {
        if ("error" in result) {
          setScreenError(result.error);
          note("warn", `Screen: ${result.error}`);
        } else {
          setScreen(result.screen);
          setVm(result.vm);
          note("info", `Screen connected in ${seconds(Date.now() - started)} · view only`);
        }
      })
      .catch(() => setScreenError("Couldn't open the VM's screen. Please try again."))
      .finally(() => {
        opening.current = false;
      });
  }, [running, screen, screenError, agentId, note, setVm]);

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
          Stopped: its files and open programs are kept, and it isn&apos;t billed for running time.
          Resume picks up where it left off.
        </p>
      ) : running && pausesIn !== null ? (
        <p className="text-caption text-run-panel-muted">
          Stops by itself, keeping its files, after {pausesIn <= 1 ? "about a minute" : `${pausesIn} minutes`} without use.
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
          onControl={() => {
            note("info", control ? "Control handed back · view only" : "You took control of the mouse and keyboard");
            setControl(!control);
          }}
          onExpand={() => setExpanded((on) => !on)}
          onRetry={() => setScreenError(null)}
        />
      )}

      {/* CPU, memory, disk: real readings from E2B while it runs */}
      {running && (
        <dl className="m-0 grid grid-cols-3 gap-2">
          {[
            {
              label: "CPU",
              value: stats ? `${stats.cpuCount} vCPU` : "—",
              sub: stats?.cpuUsedPct !== null && stats?.cpuUsedPct !== undefined ? `${stats.cpuUsedPct}% used` : null,
            },
            // Used on the first line, the total under it: "587 MB / 7.8 GB" doesn't fit a third
            // of the panel.
            {
              label: "Memory",
              value: stats ? (stats.memoryUsedMB !== null ? size(stats.memoryUsedMB) : size(stats.memoryTotalMB)) : "—",
              sub: stats && stats.memoryUsedMB !== null ? `of ${size(stats.memoryTotalMB)}` : null,
            },
            {
              label: "Disk",
              value: stats?.diskTotalMB ? size(stats.diskUsedMB) : "—",
              sub: stats?.diskTotalMB ? `of ${size(stats.diskTotalMB)}` : null,
            },
          ].map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-run-panel px-2.5 py-2 dark:border-white/[0.06]">
              <dt className="text-caption text-run-panel-muted">{item.label}</dt>
              <dd className="m-0 truncate font-mono text-caption text-run-panel-foreground tabular-nums" title={item.value}>
                {item.value}
              </dd>
              {item.sub && <dd className="m-0 font-mono text-[11px] leading-4 text-run-panel-muted tabular-nums">{item.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      {/* What happened to the VM, as this page saw it */}
      {log.length > 0 && <VmLog lines={log} />}

      {/* Controls, or the question Delete asks first */}
      {confirmStop && (running || vm.status === "paused") ? (
        <div
          role="alertdialog"
          aria-label="Delete the VM"
          className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 dark:border-[#F87171]/30 dark:bg-[#F87171]/10"
        >
          <p className="text-body-s">
            <span className="font-semibold">Delete the VM?</span>{" "}
            <span className="text-run-panel-muted">
              The VM and everything on it will be removed. To keep its files, stop it instead.
            </span>
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
              onClick={() => void act("stop")}
            >
              {busy ? <Spinner className="border-white/30 border-t-white" /> : <Trash2 className="size-4" />}
              {busy ? "Deleting" : "Delete VM"}
            </button>
          </div>
        </div>
      ) : (
      <div className="flex gap-2">
        {vm.status === "stopped" || vm.status === "error" ? (
          <button type="button" className={cn(GO, "flex-1")} disabled={!ready || moving} onClick={() => void act("start")}>
            {busy ? <Spinner className="border-white/30 border-t-white" /> : <Play className="size-4 fill-current" />}
            {busy ? "Starting VM" : "Start VM"}
          </button>
        ) : vm.status === "paused" ? (
          <button type="button" className={cn(GO, "flex-1")} disabled={moving} onClick={() => void act("resume")}>
            {busy ? <Spinner className="border-white/30 border-t-white" /> : <Play className="size-4 fill-current" />}
            {busy ? "Resuming" : "Resume"}
          </button>
        ) : running ? (
          <button
            type="button"
            className={cn(OUTLINE, "flex-1")}
            disabled={moving}
            onClick={() => void act("pause")}
            title="Stop the VM. Its files and open programs are kept; resume any time."
          >
            <Square className="size-3.5 fill-current" />
            Stop
          </button>
        ) : (
          <button type="button" className={cn(OUTLINE, "flex-1")} disabled>
            <Spinner />
            {status.label}
          </button>
        )}

        {(running || vm.status === "paused") && (
          <button
            type="button"
            className={cn(DANGER, "flex-1")}
            disabled={moving}
            onClick={() => setConfirmStop(true)}
            title="Delete the VM and everything on it"
          >
            <Trash2 className="size-4" />
            Delete VM
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/** The activity log, terminal style (`.term` in 21-chat-run-panel), kept scrolled to the end. */
function VmLog({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={box}
      role="log"
      aria-label="VM activity"
      className="flex max-h-[132px] flex-col overflow-y-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-caption leading-[18px] text-run-panel-muted dark:border-white/[0.06] dark:bg-[#08091A]"
    >
      {lines.map((line) => (
        <div
          key={line.id}
          title={new Date(line.at).toLocaleTimeString()}
          className={cn(
            "break-words",
            line.kind === "cmd" && "text-run-panel-foreground",
            line.kind === "ok" && "text-[#15803D] dark:text-[#4ADE80]",
            line.kind === "warn" && "text-destructive dark:text-[#F87171]",
          )}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}

/**
 * What the screen looks like before there is one (the animated desktop from the
 * 21-chat-run-panel draft): a browser window on the VM's desktop, the pointer gliding over
 * it. Marked as a preview everywhere it shows, so it is never taken for the real VM.
 * Greyed and still while the VM is stopped.
 */
function ScreenPreview({ still }: { still: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute inset-0 flex flex-col bg-[linear-gradient(135deg,#2B2F55,#1B1E38)]",
        still && "brightness-75 grayscale",
      )}
    >
      {/* Browser window */}
      <div className="absolute top-[5%] right-[4%] bottom-[13%] left-[4%] flex flex-col overflow-hidden rounded-[6px] bg-white shadow-[0_6px_20px_rgba(0,0,0,0.4)]">
        <div className="flex items-center gap-1 bg-[#ECEEF5] px-1.5 py-1">
          <i className="block size-1.5 rounded-full bg-[#C9CCDA]" />
          <i className="block size-1.5 rounded-full bg-[#C9CCDA]" />
          <i className="block size-1.5 rounded-full bg-[#C9CCDA]" />
          <span className="ml-1.5 flex-1 truncate rounded-[4px] bg-white px-1.5 font-mono text-[8px] leading-3 text-[#646A85]">
            https://news.example.com/ai/today
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-[5px] px-2.5 py-2">
          <div className="h-2 w-[70%] rounded-[3px] bg-[#14162A]" />
          <div className="h-[5px] w-[92%] rounded-[3px] bg-[#E3E5EE]" />
          <div className="h-[5px] w-[84%] rounded-[3px] bg-[#FACC15]/55" />
          <div className="h-[5px] w-[88%] rounded-[3px] bg-[#E3E5EE]" />
          <div className="h-[5px] w-[60%] rounded-[3px] bg-[#E3E5EE]" />
          <div className="mt-1 h-2 w-1/2 rounded-[3px] bg-[#14162A]" />
          <div className="h-[5px] w-[90%] rounded-[3px] bg-[#E3E5EE]" />
          <div className="h-[5px] w-[76%] rounded-[3px] bg-[#E3E5EE]" />
        </div>
      </div>
      {/* Taskbar */}
      <div className="absolute inset-x-0 bottom-0 flex h-[11%] items-center justify-between bg-[#08091A]/75 px-2 font-mono text-[9px] text-[#B9BED3]">
        <span>Preview of the VM&apos;s desktop</span>
        <span>Start the VM to see it live</span>
      </div>
      {/* The pointer */}
      <svg
        viewBox="0 0 24 24"
        className={cn(
          "absolute top-[40%] left-[30%] size-3",
          !still && "animate-[omnix-cursor_6s_ease-in-out_infinite]",
        )}
      >
        <path d="M5 3v16l4.5-4.5L13 21l2.5-1-3.5-6.5H18z" fill="#FFFFFF" stroke="#14162A" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
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
      ) : running && screenError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-caption text-run-panel-muted">
          <TriangleAlert className="size-5 text-destructive dark:text-[#F87171]" />
          {screenError}
          <button type="button" onClick={onRetry} className="cursor-pointer font-medium text-brand-text underline-offset-2 hover:underline dark:text-[#A5ABFB]">
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* The animated preview until the real screen arrives: moving while off, greyed
              while stopped, behind the spinner while it starts or connects. */}
          <ScreenPreview still={status === "paused" || status === "pausing"} />
          {running || status === "starting" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#08091A]/55 text-caption font-medium text-white">
              <Spinner />
              {running ? "Connecting to the screen…" : "Starting the VM…"}
            </div>
          ) : status === "paused" || status === "pausing" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#08091A]/40 text-caption font-medium text-white">
              Resume the VM to see its screen
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const bar = (
    <div className="flex items-center gap-2">
      <span className="text-caption font-medium text-run-panel-muted">Live screen</span>
      {!(running && screen) && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-run-panel-muted dark:bg-white/[0.06]">
          Preview
        </span>
      )}
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
