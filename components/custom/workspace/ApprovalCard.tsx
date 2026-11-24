"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, Clock, Loader2, Lock, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/agent/events";

export type CardProps = {
  request: ApprovalRequest;
  state: "pending" | "deciding" | ApprovalDecision;
  /** True while anything else is in flight, so one decision runs at a time. */
  busy: boolean;
  onDecide: (decision: "approve" | "reject") => void;
};

/** The buttons in words that say what will happen. */
const ACTIONS: Record<string, { approve: string; reject: string }> = {
  "gmail.send": { approve: "Send email", reject: "Don’t send" },
  "gmail.create_draft": { approve: "Save draft", reject: "Don’t save" },
};

/**
 * The approval card (the amber box in 14-inbox): what the agent is about to do, in the
 * agent's own data rather than its own words. Used inline in chat and in the inbox.
 *
 * The values here come from the stored action, so what is shown is what will run. That is
 * the whole point — an agent reading a stranger's email can be talked into sending one,
 * and the only reliable defence is a person seeing the real recipient and the real body
 * before it goes (docs/07-security.md).
 */
export function ApprovalCard({ request, state, busy, onDecide }: CardProps) {
  const pending = state === "pending" || state === "deciding";
  const deciding = state === "deciding";
  const words = ACTIONS[request.tool] ?? { approve: "Approve", reject: "Reject" };

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-warning-subtle p-4">
      <div className="flex items-start gap-2 text-warning-text">
        <Lock className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1 font-semibold">{request.summary}</span>
        {pending && (
          <span className="shrink-0 text-caption font-medium">
            expires {formatDistanceToNow(new Date(request.expiresAt), { addSuffix: true })}
          </span>
        )}
      </div>
      <p className="text-body-s">
        {request.label} · uses{" "}
        <code className="rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
          {request.tool}
        </code>
      </p>

      <dl className="m-0 flex flex-col gap-2 rounded-[10px] bg-card px-3 py-2.5 text-body-s">
        {request.details.map((detail) => (
          <div key={detail.label} className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">{detail.label}</dt>
            <dd className="m-0 min-w-0 flex-1 break-words whitespace-pre-wrap">
              {detail.value || <span className="text-muted-foreground">(empty)</span>}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {pending ? (
          <>
            <Button size="sm" disabled={busy || deciding} onClick={() => onDecide("approve")}>
              {deciding && <Loader2 className="animate-spin" />}
              {deciding ? "Working…" : words.approve}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || deciding} onClick={() => onDecide("reject")}>
              {words.reject}
            </Button>
            {!request.resumable && (
              <span className="text-caption text-muted-foreground">
                The agent won&apos;t carry on afterwards — this turn was too large to keep.
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-body-s text-muted-foreground">
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
