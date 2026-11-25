import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { MessageSquare, TriangleAlert } from "lucide-react";

import { AgentCard, NewAgentCard } from "@/components/custom/design/AgentCard";
import { HeroWash, PageWrap } from "@/components/custom/design/HeroWash";
import { Greeting } from "@/components/custom/home/Greeting";
import { HomeComposer } from "@/components/custom/home/HomeComposer";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { agents, conversations, db } from "@/db";
import { listAgentCards } from "@/lib/agent-cards";
import { CHAT_MODEL, hasModelKey } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { agentFacts } from "@/lib/agent-facts";
import { suggestionsFor } from "@/lib/agent-guide";
import { listConnections } from "@/lib/integrations/connections";
import { listTasks } from "@/lib/tasks";
import { listToolSettings } from "@/lib/tools";
import { modelLabel, shortWhen } from "@/lib/format";

const HOME_AGENTS = 5;
const RECENT_CHATS = 6;

/** Home (design/reference/03-home.html): greeting, composer, your agents, recent chats. */
export default async function WorkspacePage() {
  const user = await getCurrentUser();
  // The workspace is behind the proxy's sign-in check, so this only happens mid-sign-out.
  if (!user) return null;

  const [cards, pickable, recent] = await Promise.all([
    listAgentCards(user.id, HOME_AGENTS),
    // Every agent, for the composer's picker.
    db.select().from(agents).where(eq(agents.userId, user.id)).orderBy(desc(agents.createdAt)),
    // Latest chats across every agent, so the user can pick up where they left off.
    db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
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

  // Each agent's own chat starters (lib/agent-guide.ts), so the chips under the composer fit
  // whichever agent is picked rather than being the same few for everyone.
  const connections = await listConnections(user.id);
  const starters = Object.fromEntries(
    await Promise.all(
      pickable.map(async (agent) => {
        const [tools, tasks] = await Promise.all([listToolSettings(agent), listTasks(agent.id, user.id)]);
        return [agent.id, suggestionsFor(agentFacts(agent, { tools, connections, tasks }), 4)] as const;
      }),
    ),
  );

  const firstName = user.name?.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="relative overflow-hidden">
      <HeroWash />
      <PageWrap>
        <div className="flex flex-col gap-2">
          <Greeting firstName={firstName} />
          <p className="text-body-l text-muted-foreground">
            Ask an agent, or create one that runs on its own.
          </p>
        </div>

        {!hasModelKey() && (
          <p className="flex items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-body-s text-warning-text">
            <TriangleAlert className="size-4 shrink-0" />
            AI isn&apos;t set up yet: add OPENROUTER_API_KEY to .env and restart the dev server.
          </p>
        )}

        <HomeComposer
          agents={pickable.map(({ id, name, avatarSeed }) => ({ id, name, avatarSeed }))}
          starters={starters}
          model={{ id: CHAT_MODEL, label: modelLabel(CHAT_MODEL) }}
        />

        <div className="flex items-center justify-between pt-4">
          <h2 className="text-h2 font-semibold">Your agents</h2>
          <Link href="/workspace/agents" className="font-semibold text-brand-text hover:underline">
            View all
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {cards.map((card) => (
            <AgentCard key={card.id} agent={card} />
          ))}
          <NewAgentCard />
        </div>

        {recent.length > 0 && (
          <>
            <h2 className="pt-4 text-h2 font-semibold">Recent chats</h2>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {recent.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/workspace/agent/${chat.agentId}?c=${chat.id}`}
                  className="flex min-h-[52px] items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-muted/60"
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{chat.title}</span>
                  <span className="hidden items-center gap-2 md:flex">
                    <span className="size-5">
                      <AgentAvatar seed={chat.avatarSeed} name="" />
                    </span>
                    <span className="text-body-s text-muted-foreground">{chat.agentName}</span>
                  </span>
                  <span className="shrink-0 text-body-s text-muted-foreground">
                    {shortWhen(chat.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </PageWrap>
    </div>
  );
}
