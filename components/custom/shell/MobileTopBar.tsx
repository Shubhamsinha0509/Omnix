"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Plus } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SidebarContent, type ShellUser, type SidebarAgent } from "./AppSidebar";
import { Logo } from "./Logo";

/**
 * Below 768px the sidebar becomes this 56px bar (`header.topbar`): menu, logo, and a
 * create button. The menu opens the same sidebar content in a sheet from the left.
 */
export function MobileTopBar(props: {
  agents: SidebarAgent[];
  unread: number;
  user: ShellUser;
  tokensUsedPercent: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-card pr-2 pl-1 md:hidden">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Open menu"
        className="[&_svg:not([class*='size-'])]:size-[22px]"
        onClick={() => setOpen(true)}
      >
        <Menu />
      </Button>
      <span className="min-w-0 flex-1">
        <Logo />
      </span>
      <Link
        href="/workspace/create-agent"
        aria-label="Create new agent"
        className={cn(buttonVariants({ size: "icon-lg" }))}
      >
        <Plus />
      </Link>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 overflow-y-auto bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SidebarContent {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
