"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, House, Inbox, Plug, Plus, Settings, Store } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import type { SidebarAgent } from "./AppSidebar";

const OPEN_EVENT = "omnix:open-search";

/** Opens the search palette from anywhere (the sidebar's Search row, the ⌘K shortcut). */
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const PAGES = [
  { label: "Home", href: "/workspace", icon: House },
  { label: "Agents", href: "/workspace/agents", icon: Bot },
  { label: "Create new agent", href: "/workspace/create-agent", icon: Plus },
  { label: "Inbox", href: "/workspace/inbox", icon: Inbox },
  { label: "Integrations", href: "/workspace/integrations", icon: Plug },
  { label: "Marketplace", href: "/workspace/marketplace", icon: Store },
  { label: "Settings", href: "/workspace/settings", icon: Settings },
];

/** Search (⌘K / Ctrl+K): jump to an agent or a page. */
export function SearchCommand({ agents }: { agents: SidebarAgent[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Find an agent or a page">
      <CommandInput placeholder="Search agents and pages…" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>
        {agents.length > 0 && (
          <CommandGroup heading="Agents">
            {agents.map((agent) => (
              <CommandItem
                key={agent.id}
                value={`agent ${agent.name}`}
                onSelect={() => go(`/workspace/agent/${agent.id}`)}
              >
                <span className="size-5 shrink-0">
                  <AgentAvatar seed={agent.avatarSeed} name="" />
                </span>
                {agent.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {PAGES.map(({ label, href, icon: Icon }) => (
            <CommandItem key={href} value={`page ${label}`} onSelect={() => go(href)}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
