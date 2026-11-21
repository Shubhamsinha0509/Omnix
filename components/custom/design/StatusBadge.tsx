import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AgentStatus = "active" | "running" | "paused" | "draft" | "error";

const STATUS = {
  active: { label: "Active", variant: "ok", dot: "bg-status-active" },
  running: { label: "Running", variant: "run", dot: "bg-brand" },
  paused: { label: "Paused", variant: "pause", dot: "bg-status-paused" },
  draft: { label: "Draft", variant: "neutral", dot: null },
  error: { label: "Failed", variant: "err", dot: "bg-destructive" },
} as const;

/** An agent's state as the design shows it: a dot and a word (`.badge.b-ok` etc.). */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: AgentStatus;
  label?: string;
  className?: string;
}) {
  const { label: fallback, variant, dot } = STATUS[status];
  return (
    <Badge variant={variant} className={className}>
      {dot && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />}
      {label ?? fallback}
    </Badge>
  );
}
