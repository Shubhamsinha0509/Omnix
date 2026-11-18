"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronsUpDown, Plus, Store } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

type Agent = {
  id: string;
  name: string;
  color: string; // used for the generated avatar when there is no image
  image?: string;
};

// Placeholder data — replace with the user's agents from the database.
const SAMPLE_AGENTS: Agent[] = [
  { id: "inbox-assistant", name: "Inbox Assistant", color: "#2563eb" },
  { id: "research-buddy", name: "Research Buddy", color: "#e11d48" },
  { id: "daily-planner", name: "Daily Planner", color: "#f59e0b" },
  { id: "content-writer", name: "Content Writer", color: "#7c3aed" },
];

/** Round face with two eyes — used for the Omnix logo and default agent avatars. */
function FaceMark({ color, className = "" }: { color: string; className?: string }) {
  return (
    <span
      className={`flex size-full items-center justify-center gap-[12%] rounded-full ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      <span className="h-[34%] w-[16%] translate-y-[15%] -rotate-12 rounded-full bg-white" />
      <span className="h-[34%] w-[16%] translate-y-[15%] -rotate-12 rounded-full bg-white" />
    </span>
  );
}

function AgentAvatar({ agent }: { agent: Agent }) {
  return (
    <Avatar size="sm" className="after:hidden">
      {agent.image && <AvatarImage src={agent.image} alt={agent.name} />}
      <AvatarFallback className="bg-transparent">
        <FaceMark color={agent.color} />
      </AvatarFallback>
    </Avatar>
  );
}

const AppSidebar = () => {
  const pathname = usePathname();
  const { data: session } = useSession();

  const userName = session?.user?.name ?? "Guest";
  const userImage = session?.user?.image ?? undefined;
  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar>
      {/* Logo + primary action */}
      <SidebarHeader className="gap-4 px-3 pt-5 pb-2">
        <Link href="/workspace" className="flex items-center gap-2.5 px-1">
          <span className="size-8">
            <FaceMark color="#2563eb" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Omnix</span>
        </Link>

        <Link
          href="/workspace/agents/new"
          className={buttonVariants({ size: "lg", className: "w-full gap-2" })}
        >
          <Plus />
          Create New Agent
        </Link>
      </SidebarHeader>

      {/* Agent list */}
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupLabel className="uppercase tracking-wider">
            Your Agents
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {SAMPLE_AGENTS.map((agent) => {
                const href = `/workspace/agent/${agent.id}`;
                return (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton
                      size="lg"
                      className="h-10"
                      isActive={pathname === href}
                      render={<Link href={href} />}
                    >
                      <AgentAvatar agent={agent} />
                      <span>{agent.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: marketplace + current user */}
      <SidebarFooter className="gap-1 px-3 pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname.startsWith("/workspace/marketplace")}
              render={<Link href="/workspace/marketplace" />}
            >
              <Store />
              <span>Marketplace</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarSeparator className="mx-0 my-1" />

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <Avatar>
                {userImage && <AvatarImage src={userImage} alt={userName} />}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate font-medium">{userName}</span>
              <ChevronsUpDown className="text-muted-foreground" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
