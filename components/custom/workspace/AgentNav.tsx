import Link from "next/link";
import { CalendarClock, ListOrdered, MessageSquare, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "./AgentAvatar";

/**
 * The header on an agent's own pages — tasks, runs, settings — in the chat header's shape
 * (06-chat-messages: 64px, avatar and name) with the pages as a segmented control (`.seg`).
 * A server component: the current page is known from where it is rendered.
 */
export default function AgentNav({
  agent,
  active,
}: {
  agent: { id: string; name: string; avatarSeed: string };
  active: "tasks" | "runs" | "settings";
}) {
  const tabs = [
    { key: "chat", label: "Chat", href: `/workspace/agent/${agent.id}`, icon: MessageSquare },
    { key: "tasks", label: "Tasks", href: `/workspace/agent/${agent.id}/tasks`, icon: CalendarClock },
    { key: "runs", label: "Runs", href: `/workspace/agent/${agent.id}/runs`, icon: ListOrdered },
    { key: "settings", label: "Settings", href: `/workspace/agent/${agent.id}/settings`, icon: SlidersHorizontal },
  ] as const;

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3 md:h-16 md:flex-nowrap md:px-6 md:py-0">
      <span className="size-8 shrink-0">
        <AgentAvatar seed={agent.avatarSeed} name="" />
      </span>
      <h1 className="min-w-0 flex-1 truncate font-sans text-h3 font-semibold tracking-normal">{agent.name}</h1>
      <nav aria-label={`${agent.name} pages`} className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-muted p-1 max-md:w-full">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 font-medium whitespace-nowrap text-muted-foreground no-underline hover:text-foreground after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2",
                current && "bg-card text-foreground shadow-xs",
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
