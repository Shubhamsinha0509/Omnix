"use client";

import Link from "next/link";
import { Clock, Ellipsis, MessageSquare, Play, Plus, Settings, SquarePen } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { cn } from "@/lib/utils";
import { StatusBadge, type AgentStatus } from "./StatusBadge";

export type AgentCardData = {
  id: string;
  name: string;
  avatarSeed: string;
  instructions: string;
  status: AgentStatus;
  /** "Created today", "Last run 2h ago", "Running · 00:01:24", "Weekdays 9:30"… */
  subtitle: string;
  /** While running: the live run to open. */
  runHref?: string | null;
};

/** The shared card shell (`.acard`): 20px padding, 16px gaps, 212px tall at least. */
export const agentCardClass =
  "flex min-h-[212px] flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm";

/**
 * An agent as a card (`article.acard` in 03-home and 12-agents). A draft — an agent with
 * no instructions — shows the "add a few lines" hint and an Add instructions button in
 * place of its description and run button.
 */
export function AgentCard({ agent }: { agent: AgentCardData }) {
  const chatHref = `/workspace/agent/${agent.id}`;
  const settingsHref = `${chatHref}/settings`;
  const draft = agent.status === "draft";

  return (
    <article className={agentCardClass}>
      <div className="flex items-center gap-3">
        <span className="size-11 shrink-0">
          <AgentAvatar seed={agent.avatarSeed} name="" />
        </span>
        <Link href={chatHref} className="flex min-w-0 flex-1 flex-col text-foreground no-underline">
          <span className="truncate text-h3 font-semibold">{agent.name}</span>
          <span className="text-caption font-medium text-muted-foreground">{agent.subtitle}</span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${agent.name}`} />}
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link href={chatHref} />}>
                <MessageSquare />
                Open chat
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href={`${chatHref}/tasks`} />}>
                <Clock />
                Schedule
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href={settingsHref} />}>
                <Settings />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {draft ? (
        <>
          <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5">
            <SquarePen className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="text-body-s text-muted-foreground">
              No instructions yet. Add a few lines so it knows what to do.
            </span>
          </div>
          <div className="flex-1" />
        </>
      ) : (
        <p className="line-clamp-3 flex-1 text-body-s text-muted-foreground">{agent.instructions}</p>
      )}

      <div className="flex items-center justify-between">
        <StatusBadge status={agent.status} />
        {draft ? (
          <Link
            href={`${chatHref}?configure=instructions`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Add instructions
          </Link>
        ) : agent.status === "running" ? (
          <Link
            href={agent.runHref ?? chatHref}
            aria-label="Running"
            className="flex size-9 items-center justify-center rounded-full bg-brand-fill text-white"
          >
            <Clock className="size-4" />
          </Link>
        ) : (
          <Link
            href={chatHref}
            aria-label={`Run ${agent.name}`}
            className="flex size-9 items-center justify-center rounded-full bg-accent text-brand transition-colors hover:bg-accent/70"
          >
            <Play className="size-4 fill-current" />
          </Link>
        )}
      </div>
    </article>
  );
}

/** The dashed "Create new agent" card that ends every agent grid (`a.newcard`). */
export function NewAgentCard({ className }: { className?: string }) {
  return (
    <Link
      href="/workspace/create-agent"
      className={cn(
        "flex min-h-[212px] flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-input text-foreground no-underline transition-colors hover:bg-card",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-accent text-brand">
        <Plus className="size-5" />
      </span>
      <span className="font-semibold">Create new agent</span>
      <span className="text-body-s text-muted-foreground">Start blank or from a template</span>
    </Link>
  );
}
