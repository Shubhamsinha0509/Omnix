import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageWrap } from "@/components/custom/design/HeroWash";
import { AgentsGrid } from "@/components/custom/agents/AgentsGrid";
import { listAgentCards } from "@/lib/agent-cards";
import { getCurrentUser } from "@/lib/auth";

/** Agents (design/reference/12-agents.html), or 20-empty-agents.html when there are none. */
export default async function AgentsPage({
  searchParams,
}: {
  /** `?preview=empty` (development only) shows the empty state, for design checks. */
  searchParams: Promise<{ preview?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { preview } = await searchParams;
  const emptyPreview = process.env.NODE_ENV !== "production" && preview === "empty";
  const agents = emptyPreview ? [] : await listAgentCards(user.id);
  const running = agents.filter((agent) => agent.status === "running").length;

  const heading = (subtitle: string, action: boolean) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Agents</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      {action && (
        <Link href="/workspace/create-agent" className={buttonVariants()}>
          <Plus />
          New agent
        </Link>
      )}
    </div>
  );

  if (agents.length === 0) {
    return (
      <PageWrap>
        {heading("No agents yet", false)}
        <section className="flex flex-col items-center gap-4 rounded-lg border-[1.5px] border-dashed border-input px-6 py-16 text-center">
          <Image src="/mascot.svg" alt="" width={120} height={120} className="size-[120px]" />
          <h2 className="font-display text-h1 font-semibold tracking-[-0.015em]">Make your first agent</h2>
          <p className="max-w-[460px] text-body-l text-muted-foreground">
            An agent is a helper with instructions and tools. Give it a job, connect an app, and run it
            whenever you like.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/workspace/create-agent" className={buttonVariants()}>
              <Plus />
              Create agent
            </Link>
            <Link href="/workspace/marketplace" className={buttonVariants({ variant: "outline" })}>
              Browse templates
            </Link>
          </div>
        </section>
      </PageWrap>
    );
  }

  return (
    <PageWrap>
      {heading(
        `${agents.length} ${agents.length === 1 ? "agent" : "agents"} · ${running} running now`,
        true,
      )}
      <AgentsGrid agents={agents} />
    </PageWrap>
  );
}
