import { notFound } from "next/navigation";

import Inbox, { type InboxView } from "@/components/custom/workspace/Inbox";
import { getCurrentUser } from "@/lib/auth";
import { listInbox, type InboxItem } from "@/lib/notifications";
import { TOOLS } from "@/lib/tools";

/**
 * In-app delivery: results from tasks that ran on their own, and approval cards from
 * background runs waiting on a decision (decision D42).
 */
export default async function InboxPage() {
  const user = await getCurrentUser();
  if (!user) notFound();

  const items = await listInbox(user.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Inbox</h1>
        <p className="mt-1.5 text-muted-foreground">
          What your agents did while you were away, and anything they need you to approve.
        </p>
      </header>

      <Inbox items={items.map(toView)} />
    </div>
  );
}

function toView(item: InboxItem): InboxView {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    agentId: item.agentId,
    agentName: item.agentName,
    agentAvatarSeed: item.agentAvatarSeed,
    taskName: item.taskName,
    runId: item.runId,
    unread: item.readAt === null,
    createdAt: item.createdAt.toISOString(),
    approval:
      item.approvalId && item.approvalTool
        ? {
            id: item.approvalId,
            tool: item.approvalTool,
            label: TOOLS[item.approvalTool]?.label ?? "Waiting for approval",
            summary: item.approvalSummary ?? item.title,
            details: item.approvalDetails,
            expiresAt: item.approvalExpiresAt ?? new Date().toISOString(),
            // A background run is held open by its own wait, so it always carries on from
            // the decision — unlike a chat turn, which may have been too large to store.
            resumable: true,
          }
        : null,
    approvalState: item.approvalStatus === "pending" ? "pending" : item.approvalStatus,
  };
}
