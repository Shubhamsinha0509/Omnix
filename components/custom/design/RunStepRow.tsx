import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type RunStepState = "done" | "current" | "pending" | "failed";

/** The indigo ring that turns while a step is in progress (`.spin`). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-4 animate-[omnix-spin_1s_linear_infinite] rounded-full border-[2.5px] border-[#7C83F5]/25 border-t-[#7C83F5]",
        className,
      )}
    />
  );
}

/**
 * One step of a run on the dark run panel (`li.step` in 13-live-run): a status mark, what
 * happened, and when. The step in progress sits on a raised row.
 */
export function RunStepRow({
  state,
  label,
  time,
  children,
}: {
  state: RunStepState;
  label: React.ReactNode;
  /** "0:04", or null for "not yet". */
  time: string | null;
  /** Detail shown under the label (arguments, output). */
  children?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-md px-3 py-2",
        state === "current" && "bg-run-panel-raised",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            state === "done" && "bg-[#22C55E] text-[#08091A]",
            state === "failed" && "bg-destructive text-white",
            state === "pending" && "border-[1.5px] border-run-panel-muted",
          )}
        >
          {state === "done" && <Check className="size-3.5" strokeWidth={3} />}
          {state === "failed" && <X className="size-3.5" strokeWidth={3} />}
          {state === "current" && <Spinner />}
          <span className="sr-only">
            {{ done: "Done", current: "In progress", pending: "Not started", failed: "Failed" }[state]}
          </span>
        </span>
        <span className={cn("min-w-0 flex-1", state === "pending" && "text-run-panel-muted")}>
          {label}
        </span>
        <span className="font-mono text-caption text-run-panel-muted">{time ?? "—"}</span>
      </div>
      {children}
    </li>
  );
}
