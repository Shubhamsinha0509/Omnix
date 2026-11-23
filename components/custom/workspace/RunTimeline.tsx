import {
  Bot,
  ChevronRight,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";

import type { RunStep } from "@/db";

/**
 * One run, step by step: each model turn, each tool call and what it returned.
 *
 * Payloads are rendered as **text**, never as Markdown or HTML. A step holds whatever the
 * agent read — a web page, somebody's email — and this page is the one place that content
 * is shown back in full, so it gets no chance to be interpreted as anything but data
 * (docs/07-security.md). Secrets were already stripped when the step was written.
 */
export default function RunTimeline({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        This run wrote no steps. That usually means it failed before the first model call.
      </p>
    );
  }

  return (
    <ol className="mt-6 flex flex-col gap-2">
      {steps.map((step) => {
        const look = appearance(step);
        const payload = step.payload as Record<string, unknown>;
        const purged = payload?.purged === true;

        return (
          <li key={step.id} className="rounded-xl border">
            <div className="flex items-start gap-3 px-4 py-3">
              <look.icon className={`mt-0.5 size-4 shrink-0 ${look.tone}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{look.title}</span>
                  {step.tool && <code className="text-xs text-muted-foreground">{step.tool}</code>}
                  <span className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    }).format(step.createdAt)}
                  </span>
                </div>
                {look.summary && (
                  <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                    {look.summary}
                  </p>
                )}

                {purged ? (
                  <p className="mt-2 text-xs text-muted-foreground italic">
                    The contents of this step were cleared by the retention sweep. What ran, and
                    whether it worked, is kept.
                  </p>
                ) : (
                  <details className="group mt-2">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                      Details
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted/60 p-3 text-xs break-words whitespace-pre-wrap">
                      {asText(payload)}
                    </pre>
                  </details>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">#{step.seq}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The icon, title and one-line summary for a step, by kind. */
function appearance(step: RunStep) {
  const payload = (step.payload ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");

  switch (step.type) {
    case "model":
      return {
        icon: Bot,
        tone: "text-muted-foreground",
        title: `Model turn ${payload.iteration ?? ""}`.trim(),
        summary: shorten(text("text")) || describeCalls(payload.calls),
      };
    case "tool_call":
      return {
        icon: Wrench,
        tone: "text-muted-foreground",
        title: "Tool call",
        summary: payload.approval === "always" ? "Waiting for approval before running." : "",
      };
    case "tool_result":
      return {
        icon: Wrench,
        tone: text("error") ? "text-destructive" : "text-muted-foreground",
        title: text("error") ? "Tool failed" : "Tool result",
        summary: text("error") || (payload.trimmed ? "The result was trimmed to fit." : ""),
      };
    case "approval":
      return {
        icon: ShieldCheck,
        tone: "text-amber-600 dark:text-amber-400",
        title: `Approval ${text("decision") || "requested"}`,
        summary: text("summary"),
      };
    default:
      return {
        icon: TriangleAlert,
        tone: "text-destructive",
        title: "Error",
        summary: text("message") || reasonInWords(text("reason")),
      };
  }
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

function describeCalls(calls: unknown) {
  if (!Array.isArray(calls) || calls.length === 0) return "";
  const names = calls
    .map((call) => (call && typeof call === "object" ? String((call as { name?: unknown }).name ?? "") : ""))
    .filter(Boolean);
  return names.length > 0 ? `Asked for ${names.join(", ")}.` : "";
}

const MAX_SUMMARY = 240;
const MAX_PAYLOAD = 20_000;

function shorten(text: string) {
  const clean = text.trim();
  if (clean.length <= MAX_SUMMARY) return clean;
  return `${clean.slice(0, MAX_SUMMARY)}…`;
}

function asText(payload: unknown) {
  try {
    const json = JSON.stringify(payload, null, 2) ?? "";
    return json.length > MAX_PAYLOAD ? `${json.slice(0, MAX_PAYLOAD)}\n…[too long to show]` : json;
  } catch {
    return "(this step's details couldn't be shown)";
  }
}
