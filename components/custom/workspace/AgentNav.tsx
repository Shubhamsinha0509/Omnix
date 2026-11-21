import Link from "next/link";
import { CalendarClock, ListOrdered, MessageSquare, SlidersHorizontal } from "lucide-react";
import { cn } from "cn";

import { AgentAvatar } from "./AgentAvatar";

/**
 * The header on an agent's own pages — chat, tasks, runs, settings.
 *
 * The chat has its own full-height header, so this sits on the three pages beside it and
 * always offers the way back. A server component: these are links, and the current page
 * is known from where it is rendered rather than from the URL in the browser.
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
    {
      key: "settings",
      label: "Settings",
      href: `/workspace/agent/${agent.id}/settings`,
      icon: SlidersHorizontal,
    },
  ] as const;

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pt-5">
        <div className="size-9 shrink-0">
          <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
        </div>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{agent.name}</h1>
      </div>

      <nav className="mx-auto flex w-full max-w-3xl gap-1 px-4 pt-3">
        {tabs.map((tab) => {
          const current = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                current
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
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
