import React from "react";
import { desc, eq } from "drizzle-orm";

import AppSidebar from "@/components/custom/workspace/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { agents, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";

const WorkspaceLayout = async ({ children }: { children: React.ReactNode }) => {
  const user = await getCurrentUser();

  // The signed-in user's agents, newest first, for the sidebar.
  const userAgents = user
    ? await db
        .select({ id: agents.id, name: agents.name, avatarSeed: agents.avatarSeed })
        .from(agents)
        .where(eq(agents.userId, user.id))
        .orderBy(desc(agents.createdAt))
    : [];

  return (
    <SidebarProvider>
      <AppSidebar agents={userAgents} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
};

export default WorkspaceLayout;
