"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronsUpDown, Plug, Plus, Store } from "lucide-react";
import { cn } from "cn";

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
import { AgentAvatar } from "./AgentAvatar";

export type SidebarAgent = {
  id: string;
  name: string;
  avatarSeed: string;
};

const AppSidebar = ({ agents }: { agents: SidebarAgent[] }) => {
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
          <Image
            src="/logo.png"
            alt="Omnix logo"
            width={32}
            height={32}
            className="size-8"
            loading="eager"
          />
          <span className="text-lg font-semibold tracking-tight">Omnix</span>
        </Link>

        <Link
          href="/workspace/create-agent"
          className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
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
              {agents.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  No agents yet. Create your first one above.
                </li>
              )}
              {agents.map((agent) => {
                const href = `/workspace/agent/${agent.id}`;
                return (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton
                      size="lg"
                      className="h-10"
                      isActive={pathname === href}
                      render={<Link href={href} />}
                    >
                      <span className="size-7 shrink-0">
                        <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
                      </span>
                      <span>{agent.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: connections, marketplace + current user */}
      <SidebarFooter className="gap-1 px-3 pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname.startsWith("/workspace/connections")}
              render={<Link href="/workspace/connections" />}
            >
              <Plug />
              <span>Connections</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
