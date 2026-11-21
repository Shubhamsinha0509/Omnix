"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, House, Inbox, Layers, Plug, Plus, Search, Store, Zap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { ProfileMenu } from "./ProfileMenu";
import { openSearch } from "./SearchCommand";

export type SidebarAgent = { id: string; name: string; avatarSeed: string };
export type ShellUser = {
  name: string;
  email: string;
  image: string | null;
  plan: string;
};

type Props = {
  agents: SidebarAgent[];
  unread: number;
  user: ShellUser;
  tokensUsedPercent: number;
  /** Called after following a link: closes the mobile sheet. */
  onNavigate?: () => void;
};

/** One row of the sidebar (`.nav` in the reference): 40px, 12px radius, 18px icon. */
export function NavItem({
  href,
  active,
  icon,
  children,
  trailing,
  onNavigate,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 shrink-0 items-center gap-3 rounded-md px-3 font-medium text-foreground transition-colors hover:bg-muted max-md:h-11",
        "[&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
        active &&
          "bg-accent font-semibold text-accent-foreground hover:bg-accent [&>svg]:text-brand",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}

/**
 * Everything in the sidebar (`nav.sb` in design/reference/03-home.html). Rendered in the
 * 256px column on desktop and inside the sheet the mobile top bar opens.
 */
export function SidebarContent({ agents, unread, user, tokensUsedPercent, onNavigate }: Props) {
  const pathname = usePathname();
  const is = (href: string) => pathname === href;
  const within = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-full flex-col gap-1 px-4 py-5">
      <div className="px-2 pb-3">
        <Logo />
      </div>

      <Link
        href="/workspace/create-agent"
        onClick={onNavigate}
        className={cn(buttonVariants(), "mb-3 w-full")}
      >
        <Plus />
        Create new agent
      </Link>

      <NavItem href="/workspace" active={is("/workspace")} icon={<House />} onNavigate={onNavigate}>
        Home
      </NavItem>
      <NavItem
        href="/workspace/agents"
        active={within("/workspace/agents")}
        icon={<Bot />}
        onNavigate={onNavigate}
      >
        Agents
      </NavItem>
      <NavItem
        href="/workspace/workspaces"
        active={within("/workspace/workspaces")}
        icon={<Layers />}
        onNavigate={onNavigate}
      >
        Workspaces
      </NavItem>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openSearch();
        }}
        className="flex h-10 shrink-0 cursor-pointer items-center gap-3 rounded-md px-3 text-left max-md:h-11 font-medium text-foreground transition-colors hover:bg-muted [&>svg]:size-[18px] [&>svg]:text-muted-foreground"
      >
        <Search />
        <span className="flex-1">Search</span>
        <kbd className="rounded-full bg-muted px-2 py-0.5 font-sans text-caption font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <div className="px-3 pt-5 pb-2 text-caption font-medium text-muted-foreground">Your agents</div>
      {agents.length === 0 && (
        <p className="px-3 pb-1 text-body-s text-muted-foreground">No agents yet.</p>
      )}
      {agents.map((agent) => {
        const href = `/workspace/agent/${agent.id}`;
        return (
          <NavItem
            key={agent.id}
            href={href}
            active={within(href)}
            icon={
              <span className="size-6 shrink-0">
                <AgentAvatar seed={agent.avatarSeed} name="" />
              </span>
            }
            onNavigate={onNavigate}
          >
            {agent.name}
          </NavItem>
        );
      })}

      <div className="flex-1" />

      <NavItem
        href="/workspace/inbox"
        active={within("/workspace/inbox")}
        icon={<Inbox />}
        onNavigate={onNavigate}
        trailing={
          unread > 0 ? (
            <span
              className="rounded-full bg-brand-fill px-2 py-0.5 text-caption font-semibold text-white"
              aria-label={`${unread} unread`}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null
        }
      >
        Inbox
      </NavItem>
      <NavItem
        href="/workspace/integrations"
        active={within("/workspace/integrations")}
        icon={<Plug />}
        onNavigate={onNavigate}
      >
        Integrations
      </NavItem>
      <NavItem
        href="/workspace/marketplace"
        active={within("/workspace/marketplace")}
        icon={<Store />}
        onNavigate={onNavigate}
      >
        Marketplace
      </NavItem>

      <Link
        href="/workspace/usage"
        onClick={onNavigate}
        className="my-2 flex items-center gap-3 rounded-md bg-muted px-3 py-2.5 text-foreground no-underline"
      >
        <Zap className="size-4 shrink-0 text-brand" />
        <span className="flex flex-col">
          <span className="text-caption font-medium">{tokensUsedPercent}% of monthly tokens</span>
          <span className="text-caption font-medium text-brand-text">Upgrade for more</span>
        </span>
      </Link>

      <div className="h-px w-full bg-border" />
      <ProfileMenu user={user} onNavigate={onNavigate} />
    </div>
  );
}

/** The desktop sidebar: a 256px column that stays put while the page scrolls. */
export function AppSidebar(props: Props) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-svh w-64 shrink-0 overflow-y-auto border-r bg-sidebar md:block"
    >
      <SidebarContent {...props} />
    </nav>
  );
}
