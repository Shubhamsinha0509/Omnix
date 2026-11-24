import { notFound } from "next/navigation";

import { PageWrap } from "@/components/custom/design/HeroWash";
import Inbox, { type InboxView } from "@/components/custom/workspace/Inbox";
import { eq } from "drizzle-orm";
import { agents, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { MOCK_INBOX_ITEMS } from "@/lib/mock-data";
import { listInbox, type InboxItem } from "@/lib/notifications";
import { TOOLS } from "@/lib/tools";

/**
 * In-app delivery: results from tasks that ran on their own, and approval cards from
 * background runs waiting on a decision (decision D42).
 */
export default async function InboxPage({
  searchParams,
}: {
  /** `?preview=sample` (development only) shows sample items, for design checks. */
  searchParams: Promise<{ preview?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const items = await listInbox(user.id);
  const { preview } = await searchParams;
  if (process.env.NODE_ENV !== "production" && preview === "sample") {
    const [agent] = await db
      .select({ id: agents.id, name: agents.name, avatarSeed: agents.avatarSeed })
      .from(agents)
      .where(eq(agents.userId, user.id))
      .limit(1);
    if (agent) {
      return (
        <PageWrap width="wide">
          <Inbox items={MOCK_INBOX_ITEMS(agent)} />
        </PageWrap>
      );
    }
  }

  return (
    <PageWrap width="wide">
      <Inbox items={items.map(toView)} />
    </PageWrap>
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
