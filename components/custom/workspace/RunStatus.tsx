import { Badge } from "@/components/ui/badge";

/** A run's status and trigger in words, used by the Runs list and one run's page. */

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for you",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const TRIGGER_LABELS: Record<string, string> = {
  chat: "Chat",
  manual: "Run now",
  schedule: "Schedule",
  event: "Event",
};

export function RunStatusBadge({ status }: { status: string }) {
  const variant =
    status === "failed"
      ? "destructive"
      : status === "succeeded"
        ? "secondary"
        : ("outline" as const);

  return (
    <Badge variant={variant} className={status === "waiting_approval" ? "border-amber-500/60" : undefined}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function triggerLabel(trigger: string) {
  return TRIGGER_LABELS[trigger] ?? trigger;
}

/** "1m 12s", or "—" for a run that hasn't finished. */
export function duration(startedAt: Date, finishedAt: Date | null) {
  if (!finishedAt) return "—";
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
