"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { CalendarClock, Check, Loader2, Plug, Settings, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { updateAgent } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { TaskView } from "@/lib/tasks";
import type { ToolSetting } from "@/lib/tools";
import AgentTasks from "./AgentTasks";
import AgentTools from "./AgentTools";
import { AgentFields, type AgentDraft } from "./AgentFields";
import { DeleteAgent } from "./DeleteAgent";

export type AgentConfig = {
  /** Every tool there is, with this agent's current choice for each. */
  tools: ToolSetting[];
  /** The user's connected accounts, so a tool can be pointed at one. */
  connections: SafeConnection[];
  /** How many conversations go with the agent if it is deleted. */
  conversationCount: number;
  /** What this agent does on its own, for the Schedule tab. */
  tasks: TaskView[];
};

type Props = AgentConfig & {
  agent: { id: string; name: string; instructions: string; avatarSeed: string };
  onClose: () => void;
};

const TABS = [
  { value: "general", label: "General", icon: SlidersHorizontal },
  { value: "tools", label: "Tools", icon: Plug },
  { value: "schedule", label: "Schedule", icon: CalendarClock },
  { value: "settings", label: "Settings", icon: Settings },
] as const;

/**
 * Agent configuration beside the chat, so an agent can be tuned without leaving the
 * conversation: profile, tools, tasks and deletion. Built from the same pieces as the
 * agent's own pages, so there is one of each control rather than two that can disagree.
 */
export default function AgentConfigPanel({
  agent,
  tools,
  connections,
  conversationCount,
  tasks,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<AgentDraft>({
    name: agent.name,
    instructions: agent.instructions,
    avatarSeed: agent.avatarSeed,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const changed =
    draft.name !== agent.name ||
    draft.instructions !== agent.instructions ||
    draft.avatarSeed !== agent.avatarSeed;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startSaving(async () => {
      // `stay`: refresh in place instead of navigating, so the chat stays open.
      const result = await updateAgent(agent.id, draft, { stay: true });
      if (result?.error) setError(result.error);
      else setSaved(true);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <h2 className="font-semibold">Agent configuration</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close configuration">
          <X />
        </Button>
      </header>

      <Tabs defaultValue="general" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="px-5 pt-4">
          <TabsList className="grid h-10! w-full grid-cols-4">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} aria-label={label} title={label} className="h-full">
                <Icon />
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* General: who the agent is */}
          <TabsContent value="general">
            <form onSubmit={save} className="flex flex-col gap-5">
              <AgentFields draft={draft} onChange={(next) => { setDraft(next); setSaved(false); }} disabled={isSaving} />

              {error && (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={!draft.name.trim() || !changed || isSaving}>
                {isSaving ? <Loader2 className="animate-spin" /> : saved && !changed ? <Check /> : null}
                {isSaving ? "Saving..." : saved && !changed ? "Saved" : "Save changes"}
              </Button>
            </form>
          </TabsContent>

          {/* Tools: what the agent may do, saved as each switch changes */}
          <TabsContent value="tools">
            <AgentTools agentId={agent.id} tools={tools} connections={connections} />
          </TabsContent>

          {/* Schedule: what the agent does on its own, without leaving the chat */}
          <TabsContent value="schedule" className="flex flex-col gap-4">
            <AgentTasks agentId={agent.id} agentName={agent.name} tasks={tasks} compact />
            <p className="text-sm text-muted-foreground">
              Prefer more room?{" "}
              <Link href={`/workspace/agent/${agent.id}/tasks`} className="underline underline-offset-4">
                Open Tasks on its own page
              </Link>
              , where you can also see{" "}
              <Link href={`/workspace/agent/${agent.id}/runs`} className="underline underline-offset-4">
                every run
              </Link>
              .
            </p>
          </TabsContent>

          {/* Settings: everything else, including deletion */}
          <TabsContent value="settings" className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              Prefer more room? Open these settings{" "}
              <Link href={`/workspace/agent/${agent.id}/settings`} className="underline underline-offset-4">
                on their own page
              </Link>
              .
            </p>
            <DeleteAgent agent={agent} conversationCount={conversationCount} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
