import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Bot, MessageSquare, Plus, Settings, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { agents, conversations, db } from "@/db";
import { hasModelKey } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";

const RECENT_CHATS = 6;

export default async function WorkspacePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-24">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>Sign in to use Omnix</EmptyTitle>
            <EmptyDescription>Your agents and chats are tied to your account.</EmptyDescription>
          </EmptyHeader>
          <Link href="/sign-in" className={cn(buttonVariants({ size: "lg" }))}>
            Sign in
          </Link>
        </Empty>
      </div>
    );
  }

  // Both queries only need the user, so they run together: one round-trip, not two.
  const [myAgents, recent] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        avatarSeed: agents.avatarSeed,
        instructions: agents.instructions,
      })
      .from(agents)
      .where(eq(agents.userId, user.id))
      .orderBy(desc(agents.createdAt)),

    // Latest chats across every agent, so the user can pick up where they left off.
    db
      .select({
        id: conversations.id,
        title: conversations.title,
        agentId: agents.id,
        agentName: agents.name,
        avatarSeed: agents.avatarSeed,
      })
      .from(conversations)
      .innerJoin(agents, eq(conversations.agentId, agents.id))
      .where(eq(conversations.userId, user.id))
      .orderBy(desc(conversations.updatedAt))
      .limit(RECENT_CHATS),
  ]);

  const firstName = user.name?.trim().split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">
          {firstName ? `Welcome back, ${firstName}` : "Welcome to Omnix"}
        </h1>
        <p className="mt-1.5 text-muted-foreground">
          Create agents, give them instructions, and chat with them.
        </p>
      </header>

      {!hasModelKey() && (
        <p className="mb-8 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-4 shrink-0" />
          AI isn&apos;t set up yet: add OPENROUTER_API_KEY to .env and restart the dev server.
        </p>
      )}

      {/* Agents */}
      <section>
        <h2 className="mb-3 text-sm font-medium tracking-wider text-muted-foreground uppercase">
          Your agents
        </h2>

        {myAgents.length === 0 ? (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bot />
              </EmptyMedia>
              <EmptyTitle>No agents yet</EmptyTitle>
              <EmptyDescription>
                Your first agent can be anything — a research assistant, an editor, a planner.
              </EmptyDescription>
            </EmptyHeader>
            <Link href="/workspace/create-agent" className={cn(buttonVariants({ size: "lg" }))}>
              <Plus />
              Create New Agent
            </Link>
          </Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {myAgents.map((agent) => (
              <li key={agent.id} className="group relative">
                <Link
                  href={`/workspace/agent/${agent.id}`}
                  className="flex h-full items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/50"
                >
                  <span className="size-10 shrink-0">
                    <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate pe-7 font-medium">{agent.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                      {agent.instructions || "No instructions yet."}
                    </span>
                  </span>
                </Link>
                <Link
                  href={`/workspace/agent/${agent.id}/settings`}
                  aria-label={`${agent.name} settings`}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-sm" }),
                    "absolute end-2.5 top-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <Settings />
                </Link>
              </li>
            ))}

            <li>
              <Link
                href="/workspace/create-agent"
                className="flex h-full items-center gap-3 rounded-xl border border-dashed p-4 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Plus className="size-5" />
                </span>
                <span className="font-medium">Create New Agent</span>
              </Link>
            </li>
          </ul>
        )}
      </section>

      {/* Recent chats */}
      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium tracking-wider text-muted-foreground uppercase">
            Recent chats
          </h2>
          <ul className="divide-y rounded-xl border">
            {recent.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/workspace/agent/${chat.agentId}?c=${chat.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{chat.title}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-5">
                      <AgentAvatar seed={chat.avatarSeed} name={chat.agentName} />
                    </span>
                    {chat.agentName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
