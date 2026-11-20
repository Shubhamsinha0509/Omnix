"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "cn";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { deleteAgent, updateAgent } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { ToolSetting } from "@/lib/tools";
import AgentTools from "./AgentTools";
import { AgentFields, type AgentDraft } from "./AgentFields";

type Props = {
  agent: { id: string; name: string; instructions: string; avatarSeed: string };
  /** How many conversations will be deleted with the agent. */
  conversationCount: number;
  /** Every tool there is, with this agent's current choice for each. */
  tools: ToolSetting[];
  /** The user's connected accounts, so a tool can be pointed at one. */
  connections: SafeConnection[];
};

export default function AgentSettings({ agent, conversationCount, tools, connections }: Props) {
  const [draft, setDraft] = useState<AgentDraft>({
    name: agent.name,
    instructions: agent.instructions,
    avatarSeed: agent.avatarSeed,
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  const busy = isSaving || isDeleting;
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

  const remove = () => {
    setError(null);
    startDeleting(async () => {
      // On success the server redirects to the workspace home page.
      const result = await deleteAgent(agent.id);
      if (result?.error) {
        setConfirmOpen(false);
        setError(result.error);
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Agent settings</h1>
        <p className="mt-1.5 text-muted-foreground">
          Change what {agent.name} is called, looks like, and is told to do.
        </p>
      </header>

      <form onSubmit={save} className="flex flex-col gap-6">
        <AgentFields draft={draft} onChange={setDraft} disabled={busy} />

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
          <Button type="submit" size="lg" disabled={!draft.name.trim() || !changed || busy}>
            {isSaving && <Loader2 className="animate-spin" />}
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>

      <Separator className="my-10" />

      <AgentTools agentId={agent.id} tools={tools} connections={connections} />

      <Separator className="my-10" />

      {/* Danger zone */}
      <section className="rounded-xl border border-destructive/30 p-5">
        <h2 className="font-semibold text-destructive">Delete this agent</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.name} and{" "}
          {conversationCount === 1 ? "its 1 conversation" : `its ${conversationCount} conversations`} will
          be deleted. This can&apos;t be undone.
        </p>
        <Button
          type="button"
          variant="destructive"
          className="mt-4"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 />
          Delete agent
        </Button>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent and every conversation you had with it will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={isDeleting}>
              {isDeleting && <Loader2 className="animate-spin" />}
              {isDeleting ? "Deleting..." : "Delete agent"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
