import React from "react";
import { desc, eq } from "drizzle-orm";

import { AppSidebar } from "@/components/custom/shell/AppSidebar";
import { MobileTopBar } from "@/components/custom/shell/MobileTopBar";
import { SearchCommand } from "@/components/custom/shell/SearchCommand";
import { agents, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { MOCK_USAGE } from "@/lib/mock-data";
import { countUnread } from "@/lib/notifications";

/**
 * The app shell (design/reference/03-home.html): a 256px sidebar on desktop, a 56px top
 * bar with a slide-out menu below 768px, and the page beside or below it.
 */
const WorkspaceLayout = async ({ children }: { children: React.ReactNode }) => {
  const user = await getCurrentUser();

  // The signed-in user's agents, newest first, for the sidebar — plus how many unread
  // things their agents have left them, which is the badge beside Inbox.
  const [userAgents, unread] = user
    ? await Promise.all([
        db
          .select({ id: agents.id, name: agents.name, avatarSeed: agents.avatarSeed })
          .from(agents)
          .where(eq(agents.userId, user.id))
          .orderBy(desc(agents.createdAt)),
        countUnread(user.id),
      ])
    : [[], 0];

  const shell = {
    agents: userAgents,
    unread,
    user: {
      name: user?.name?.trim() || user?.email?.split("@")[0] || "Guest",
      email: user?.email ?? "",
      image: user?.image ?? null,
      plan: MOCK_USAGE.plan,
    },
    // TODO(backend): real token usage — see lib/mock-data.ts.
    tokensUsedPercent: MOCK_USAGE.tokensUsedPercent,
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
