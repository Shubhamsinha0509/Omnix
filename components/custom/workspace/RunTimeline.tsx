import { ChevronRight } from "lucide-react";

import { RunStepRow, type RunStepState } from "@/components/custom/design/RunStepRow";
import type { RunStep } from "@/db";
import { TOOLS } from "@/lib/tools";

/**
 * One run on the dark run panel (13-live-run): what the agent did, in order.
 *
 * Each tool call and its result become one row; model turns appear only when they produced
 * the reply. Payloads are rendered as **text**, never as Markdown or HTML: a step holds
 * whatever the agent read — a web page, somebody's email — and this is the one place it is
 * shown back in full, so it gets no chance to be read as anything but data
 * (docs/07-security.md). Secrets were already stripped when the step was written.
 */

type Row = {
  key: string;
  label: string;
  state: RunStepState;
  at: Date;
  steps: RunStep[];
};

const payloadOf = (step: RunStep) => (step.payload ?? {}) as Record<string, unknown>;
const textOf = (value: unknown) => (typeof value === "string" ? value : "");

/** The rows of a run, plus the reply it produced (the last model turn that said something). */
export function buildRunRows(
  steps: RunStep[],
  run: { status: string; error: string | null; taskId: string | null },
) {
  const rows: Row[] = [];
  let reply = "";

  for (const step of steps) {
    const payload = payloadOf(step);
    switch (step.type) {
      case "model": {
        const text = textOf(payload.text).trim();
        const calls = Array.isArray(payload.calls) ? payload.calls.length : 0;
        if (text && calls === 0) {
          reply = text;
          rows.push({ key: step.id, label: "Wrote the reply", state: "done", at: step.createdAt, steps: [step] });
        }
        break;
      }
      case "tool_call": {
        const failed = Boolean(payload.error);
        rows.push({
          key: step.id,
          label: (step.tool && TOOLS[step.tool]?.label) || step.tool || "Used a tool",
          state: failed ? "failed" : "pending",
          at: step.createdAt,
          steps: [step],
        });
        break;
      }
      case "tool_result": {
        const open = [...rows].reverse().find((row) => row.state === "pending" && row.steps[0].tool === step.tool);
        const state: RunStepState = payload.error ? "failed" : "done";
        if (open) {
          open.state = state;
          open.steps.push(step);
        } else {
          rows.push({ key: step.id, label: step.tool ?? "Tool result", state, at: step.createdAt, steps: [step] });
        }
        break;
      }
      case "approval": {
        const decision = textOf(payload.decision);
        rows.push({
          key: step.id,
          label: decision ? `Approval ${decision}` : "Asked for your approval",
          state: decision === "rejected" ? "failed" : decision ? "done" : "pending",
          at: step.createdAt,
          steps: [step],
        });
        break;
      }
      default:
        rows.push({
          key: step.id,
          label: textOf(payload.message) || reasonInWords(textOf(payload.reason)) || "Something went wrong",
          state: "failed",
          at: step.createdAt,
          steps: [step],
        });
    }
  }

  const live = ["queued", "running", "waiting_approval"].includes(run.status);
  if (live) {
    // What it is doing now: the last unfinished row, or "starting" if nothing is logged yet.
    const current = [...rows].reverse().find((row) => row.state === "pending");
    if (current) current.state = "current";
    else rows.push({ key: "now", label: steps.length ? "Thinking…" : "Starting…", state: "current", at: new Date(), steps: [] });
    if (run.taskId) rows.push({ key: "deliver", label: "Send the result to your Inbox", state: "pending", at: new Date(), steps: [] });
  } else {
    // A finished run has nothing in flight: a call with no result never got one.
    for (const row of rows) if (row.state === "pending") row.state = "failed";
    if (run.status === "failed" && !rows.some((row) => row.state === "failed")) {
      rows.push({ key: "failed", label: run.error || "The run failed", state: "failed", at: new Date(), steps: [] });
    }
  }

  return { rows, reply };
}

/** "0:04", "1:24", "12:03" since the run started. */
function offset(from: Date, at: Date) {
  const seconds = Math.max(0, Math.round((at.getTime() - from.getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function RunTimeline({
  rows,
  startedAt,
}: {
  rows: Row[];
  startedAt: Date;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/15 px-4 py-6 text-center text-body-s text-run-panel-muted">
        This run wrote no steps. That usually means it failed before the first model call.
      </p>
    );
  }

  return (
    <ol aria-live="polite" className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <RunStepRow
          key={row.key}
          state={row.state}
          label={row.label}
          time={row.steps.length ? offset(startedAt, row.at) : null}
        >
          {row.steps.length > 0 && <StepDetails steps={row.steps} />}
        </RunStepRow>
      ))}
    </ol>
  );
}

/** The logged payloads behind a row, folded away, as plain text. */
function StepDetails({ steps }: { steps: RunStep[] }) {
  const purged = steps.some((step) => payloadOf(step).purged === true);
  if (purged) {
    return (
      <p className="pl-8 text-caption text-run-panel-muted italic">
        The contents were cleared by the retention sweep. What ran, and whether it worked, is kept.
      </p>
    );
  }
  return (
    <details className="group pl-8">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-caption text-run-panel-muted hover:text-run-panel-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        Details
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-black/25 p-3 font-mono text-caption break-words whitespace-pre-wrap text-run-panel-foreground">
        {steps.map((step) => `${step.type}${step.tool ? ` · ${step.tool}` : ""}\n${asText(step.payload)}`).join("\n\n")}
      </pre>
    </details>
  );
}

/** The limits and refusals the runner logs, in plain words. */
function reasonInWords(reason: string) {
  switch (reason) {
    case "max_tool_calls":
      return "The run hit its tool-call limit and stopped.";
    case "max_iterations":
      return "The run hit its step limit and stopped.";
    case "approval_expired":
      return "Nobody answered the approval in time, so the action wasn't carried out.";
    case "tool_unavailable":
      return "The tool was switched off or lost its account before the approved action ran.";
    case "server_tool_unavailable":
      return "Web search isn't available for this model or account.";
    case "server_tool_rate_limited":
      return "Web search was rate limited.";
    default:
      return reason;
  }
}

const MAX_PAYLOAD = 20_000;

function asText(payload: unknown) {
  try {
    const json = JSON.stringify(payload, null, 2) ?? "";
    return json.length > MAX_PAYLOAD ? `${json.slice(0, MAX_PAYLOAD)}\n…[too long to show]` : json;
  } catch {
    return "(this step's details couldn't be shown)";
  }
}
