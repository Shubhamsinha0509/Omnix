"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { updateAgent } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { ToolSetting } from "@/lib/tools";
import AgentTools from "./AgentTools";
import { AgentFields, type AgentDraft } from "./AgentFields";
import { DeleteAgent } from "./DeleteAgent";

type Props = {
  agent: { id: string; name: string; instructions: string; avatarSeed: string };
  /** How many conversations will be deleted with the agent. */
  conversationCount: number;
  /** Every tool there is, with this agent's current choice for each. */
  tools: ToolSetting[];
  /** The user's connected accounts, so a tool can be pointed at one. */
  connections: SafeConnection[];
};

/** The full-page agent settings. The same pieces also make up the panel beside the chat. */
export default function AgentSettings({ agent, conversationCount, tools, connections }: Props) {
  const [draft, setDraft] = useState<AgentDraft>({
    name: agent.name,
    instructions: agent.instructions,
    avatarSeed: agent.avatarSeed,
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const changed =
    draft.name !== agent.name ||
    draft.instructions !== agent.instructions ||
    draft.avatarSeed !== agent.avatarSeed;

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startSaving(async () => {
      // On success the server redirects back to the agent's chat.
      const result = await updateAgent(agent.id, draft);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-8">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="mt-1.5 text-muted-foreground">
          Change what {agent.name} is called, looks like, and is told to do.
        </p>
      </header>

      <form onSubmit={save} className="flex flex-col gap-6">
        <AgentFields draft={draft} onChange={setDraft} disabled={isSaving} />

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Link
            href={`/workspace/agent/${agent.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            Cancel
          </Link>
          <Button type="submit" size="lg" disabled={!draft.name.trim() || !changed || isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>

      <Separator className="my-10" />

      <AgentTools agentId={agent.id} agentName={agent.name} tools={tools} connections={connections} />

      <Separator className="my-10" />

      <DeleteAgent agent={agent} conversationCount={conversationCount} />
    </div>
  );
}
