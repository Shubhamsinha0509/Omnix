"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, Clock, Loader2, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/agent/events";

export type CardProps = {
  request: ApprovalRequest;
  state: "pending" | "deciding" | ApprovalDecision;
  /** True while anything else is in flight, so one decision runs at a time. */
  busy: boolean;
  onDecide: (decision: "approve" | "reject") => void;
};

/**
 * The approval card: what the agent is about to do, in the agent's own data rather than
 * its own words. Used inline in chat and in the inbox for background runs.
 *
 * The values here come from the stored action, so what is shown is what will run. That is
 * the whole point — an agent reading a stranger's email can be talked into sending one,
 * and the only reliable defence is a person seeing the real recipient and the real body
 * before it goes (docs/07-security.md).
 */
export function ApprovalCard({ request, state, busy, onDecide }: CardProps) {
  const pending = state === "pending" || state === "deciding";
  const deciding = state === "deciding";

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/5">
      <div className="flex items-center gap-2 border-b border-amber-500/30 px-4 py-2.5">
        <ShieldCheck className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="min-w-0 flex-1 text-sm font-medium">{request.summary}</span>
        {pending && (
          <span className="shrink-0 text-xs text-muted-foreground">
            expires {formatDistanceToNow(new Date(request.expiresAt), { addSuffix: true })}
          </span>
        )}
      </div>

      <dl className="divide-y divide-amber-500/20 px-4 py-1 text-sm">
        {request.details.map((detail) => (
          <div key={detail.label} className="flex gap-3 py-2">
            <dt className="w-20 shrink-0 text-muted-foreground">{detail.label}</dt>
            <dd className="min-w-0 flex-1 break-words whitespace-pre-wrap">
              {detail.value || <span className="text-muted-foreground">(empty)</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-amber-500/30 px-4 py-3">
        {pending ? (
          <>
            <Button size="sm" disabled={busy || deciding} onClick={() => onDecide("approve")}>
              {deciding ? <Loader2 className="animate-spin" /> : <Check />}
              {deciding ? "Working..." : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || deciding}
              onClick={() => onDecide("reject")}
            >
              <X />
              Reject
            </Button>
            {!request.resumable && (
              <span className="text-xs text-muted-foreground">
                The agent won&apos;t carry on afterwards — this turn was too large to keep.
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {state === "approved" ? (
              <>
                <Check className="size-4" /> Approved — this was carried out.
              </>
            ) : state === "rejected" ? (
              <>
                <X className="size-4" /> Rejected — nothing happened.
              </>
            ) : (
              <>
                <Clock className="size-4" /> Expired without a decision, so nothing happened.
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export default ApprovalCard;
