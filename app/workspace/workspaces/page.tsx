import { count, eq } from "drizzle-orm";
import { Layers, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ComingSoonButton } from "@/components/custom/design/ComingSoonButton";
import { PageWrap } from "@/components/custom/design/HeroWash";
import { agents, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { MOCK_WORKSPACES } from "@/lib/mock-data";

/**
 * Workspaces: in the redesign's sidebar, with no reference screen and no backend yet, so
 * it is built from the shared pieces. Your agents all live in your personal workspace.
 * TODO(backend): see MOCK_WORKSPACES in lib/mock-data.ts.
 */
export default async function WorkspacesPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [{ total }] = await db.select({ total: count() }).from(agents).where(eq(agents.userId, user.id));

  return (
    <PageWrap>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Workspaces</h1>
          <p className="text-muted-foreground">Group agents and share them with your team.</p>
        </div>
        <ComingSoonButton message="Shared workspaces are coming soon">
          <Plus />
          New workspace
        </ComingSoonButton>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {MOCK_WORKSPACES.map((workspace) => (
          <article key={workspace.key} className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-md bg-accent text-brand">
                <Layers className="size-5" />
              </span>
              <div className="flex flex-col">
                <h2 className="text-h3 font-semibold">{workspace.name}</h2>
                <span className="text-caption font-medium text-muted-foreground">{workspace.note}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-body-s text-muted-foreground">
                {total} {total === 1 ? "agent" : "agents"}
              </span>
              <Badge variant="run">Current</Badge>
            </div>
          </article>
        ))}
      </div>
    </PageWrap>
  );
}
