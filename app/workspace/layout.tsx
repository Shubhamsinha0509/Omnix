import React from "react";
import { desc, eq } from "drizzle-orm";

import AppSidebar from "@/components/custom/workspace/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { agents, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { countUnread } from "@/lib/notifications";

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

  return (
    <SidebarProvider>
      <AppSidebar agents={userAgents} unread={unread} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
};

export default WorkspaceLayout;
