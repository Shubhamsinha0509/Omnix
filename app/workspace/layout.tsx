import React from "react";
import { desc, eq } from "drizzle-orm";

import { AppSidebar } from "@/components/custom/shell/AppSidebar";
import { MobileTopBar } from "@/components/custom/shell/MobileTopBar";
import { SearchCommand } from "@/components/custom/shell/SearchCommand";
import { agents, db } from "@/db";
import { redirect } from "next/navigation";

import { getCurrentUser, hasOrphanSession } from "@/lib/auth";
import { MOCK_CURRENT_PLAN_ID } from "@/lib/mock-data";
import { getPlan } from "@/lib/pricing";
import { getMonthlyUsage } from "@/lib/usage";
import { countUnread } from "@/lib/notifications";

/**
 * The app shell (design/reference/03-home.html): a 256px sidebar on desktop, a 56px top
 * bar with a slide-out menu below 768px, and the page beside or below it.
 */
const WorkspaceLayout = async ({ children }: { children: React.ReactNode }) => {
  const user = await getCurrentUser();
  // A session for an account that's gone (deleted in Settings): it can't own anything, so
  // send it to sign in again, which starts a new, empty account.
  if (!user && (await hasOrphanSession())) redirect("/sign-in");

  // The signed-in user's agents, newest first, for the sidebar — plus how many unread
  // things their agents have left them, which is the badge beside Inbox.
  const [userAgents, unread, usage] = user
    ? await Promise.all([
        db
          .select({ id: agents.id, name: agents.name, avatarSeed: agents.avatarSeed })
          .from(agents)
          .where(eq(agents.userId, user.id))
          .orderBy(desc(agents.createdAt)),
        countUnread(user.id),
        getMonthlyUsage(user.id),
      ])
    : [[], 0, null];

  const plan = getPlan(MOCK_CURRENT_PLAN_ID);

  const shell = {
    agents: userAgents,
    unread,
    user: {
      name: user?.name?.trim() || user?.email?.split("@")[0] || "Guest",
      email: user?.email ?? "",
      image: user?.image ?? null,
      plan: plan.name,
    },
    // This month's real tokens against the plan's allowance (lib/pricing.ts).
    tokensUsedPercent: Math.min(
      100,
      Math.round(((usage?.tokens ?? 0) / plan.allowances.tokensPerMonth) * 100),
    ),
  };

  return (
    <div className="flex min-h-svh flex-col bg-background md:flex-row">
      <AppSidebar {...shell} />
      <MobileTopBar {...shell} />
      <main className="relative min-w-0 flex-1">{children}</main>
      <SearchCommand agents={userAgents} />
    </div>
  );
};

export default WorkspaceLayout;
