"use client";

import { useState, useTransition } from "react";
import {
  AppWindow,
  Check,
  Clock,
  FileDown,
  FileText,
  Lock,
  Monitor,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { setAgentVm } from "@/app/workspace/actions";
import type { VmState } from "@/lib/vm-state";

/**
 * The agent's Isolated VM as one setting, and the warning a scheduled task gets when it
 * would stop for approval (design/reference/22-vm-setting-and-task-warning.html, D53).
 * The setting itself is read from the tool grants by `vmStateOf` (lib/vm-state.ts).
 */

const GIVES = [
  { icon: SquareTerminal, label: "Run code" },
  { icon: FileText, label: "Save, read and list files" },
  { icon: FileDown, label: "Hand you files" },
  { icon: AppWindow, label: "Open pages in its browser" },
];

/** The Settings tab row: the switch, and what it means once it's on. */
export function VmSettingRow({ agentId, agentName, vm }: { agentId: string; agentName: string; vm: VmState }) {
  const [state, setState] = useState(vm);
  const [error, setError] = useState<string | null>(null);
  const [busy, startSaving] = useTransition();

  const save = (next: { enabled: boolean; trusted: boolean }) => {
    const before = state;
    setState({ ...state, ...next });
    setError(null);
    startSaving(async () => {
      const result = await setAgentVm(agentId, { enabled: next.enabled, trustCode: next.trusted });
      if (result?.error) {
        setState(before);
        setError(result.error);
      }
    });
  };

  return (
    <div>
      <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
        <ShieldCheck className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-medium">
            Isolated VM
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px] font-semibold">
              NEW
            </Badge>
          </span>
          <span className="text-body-s text-muted-foreground">
            {!state.available
              ? "Needs E2B_API_KEY in .env."
              : state.enabled
                ? "A private computer for this agent: run code, keep files, browse."
                : "Off: this agent has no VM. Turn on to let it run code, keep files and browse."}
          </span>
        </span>
        <Switch
          checked={state.available && state.enabled}
          disabled={!state.available || busy}
          onCheckedChange={(checked) => save({ enabled: Boolean(checked), trusted: state.trusted })}
          aria-label="Isolated VM"
        />
      </div>

      {error && (
        <p role="alert" className="mx-4 mb-3 rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}

      {state.available && state.enabled && (
        <div className="flex flex-col gap-3 pr-4 pb-4 pl-[46px]">
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-muted-foreground">Gives {agentName}</span>
            <div className="flex flex-wrap gap-1.5">
              {GIVES.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-muted px-2.5 text-caption font-medium text-muted-foreground"
                >
                  <Icon className="size-3.5 text-brand" aria-hidden="true" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">Run code without asking</span>
              <span className="text-body-s text-muted-foreground">
                {state.trusted
                  ? "On: programs run straight away, in chat and in scheduled tasks. The VM holds none of your keys."
                  : "Off: you approve each program before it runs. Scheduled tasks wait in your Inbox for that."}
              </span>
            </span>
            <Switch
              checked={state.trusted}
              disabled={busy}
              onCheckedChange={(checked) => save({ enabled: true, trusted: Boolean(checked) })}
              aria-label="Run code without asking"
            />
          </div>

          <div className="flex flex-col gap-1.5 text-body-s text-muted-foreground">
            <span className="flex items-start gap-2">
              <Clock className="mt-[3px] size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
              Starts when the agent first needs it, stops itself after 10 idle minutes and keeps its files.
            </span>
            <span className="flex items-start gap-2">
              <Lock className="mt-[3px] size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
              Holds none of your keys or accounts. Billed per second while running.
            </span>
            <span className="flex items-start gap-2">
              <Monitor className="mt-[3px] size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
              Watch it, start or stop it in the run panel beside the chat.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shown on a scheduled task when its agent's VM is on but still asks before running code:
 * nobody is there to answer when the task runs by itself, so every run would stop in the
 * Inbox. One click fixes it; "Keep asking" is a real choice and is respected.
 */
export function TaskApprovalWarning({
  agentId,
  agentName,
  vm,
}: {
  agentId: string;
  agentName: string;
  vm: VmState;
}) {
  const [trusted, setTrusted] = useState(vm.trusted);
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startSaving] = useTransition();

  if (!vm.available || !vm.enabled) return null;

  if (trusted) {
    return vm.trusted ? null : (
      // Just switched on here: say so once, where it happened.
      <div role="status" className="flex items-start gap-2.5 rounded-lg bg-[#16A34A]/[0.08] px-4 py-3 text-[#15803D] dark:bg-[#22C55E]/10 dark:text-[#4ADE80]">
        <Check className="mt-[3px] size-4 shrink-0" aria-hidden="true" />
        <p className="text-body-s">
          <span className="font-semibold">{agentName} will run code without asking.</span> Change it any time in
          Settings → Isolated VM.
        </p>
      </div>
    );
  }

  if (kept) {
    return (
      <p className="text-body-s text-muted-foreground">
        Each run will wait in your Inbox for approval before it runs code.
      </p>
    );
  }

  const trust = () => {
    setError(null);
    startSaving(async () => {
      const result = await setAgentVm(agentId, { enabled: true, trustCode: true });
      if (result?.error) setError(result.error);
      else setTrusted(true);
    });
  };

  return (
    <div
      role="status"
      className="flex flex-col gap-2.5 rounded-lg border border-[#F59E0B]/45 bg-warning-subtle px-4 py-3.5 dark:border-[#F59E0B]/40"
    >
      <div className="flex items-start gap-2.5 text-warning-text">
        <TriangleAlert className="mt-[3px] size-4 shrink-0" aria-hidden="true" />
        <p className="text-body-s">
          <span className="font-semibold">This task will wait for you each time it runs code.</span> {agentName} asks
          before running code in its VM, and nobody is there to answer when it runs by itself, so each run will
          stop in your Inbox until you approve.
        </p>
      </div>
      {error && <p className="text-body-s text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={trust}
          disabled={busy}
          className="bg-[#D97706] text-white hover:bg-[#B45309] dark:bg-[#F59E0B] dark:text-[#14162A] dark:hover:bg-[#FBBF24]"
        >
          Let it run code without asking
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setKept(true)} disabled={busy}>
          Keep asking
        </Button>
      </div>
    </div>
  );
}
