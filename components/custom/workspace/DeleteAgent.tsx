"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { deleteAgent } from "@/app/workspace/actions";

/**
 * The "delete this agent" block with its confirmation. Shared by the settings page and
 * the configuration panel beside the chat, so both delete the same way.
 */
export function DeleteAgent({
  agent,
  conversationCount,
}: {
  agent: { id: string; name: string };
  /** How many conversations go with it, for the warning. */
  conversationCount: number;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

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
    <section className="rounded-xl border border-destructive/30 p-5">
      <h2 className="font-semibold text-destructive">Delete this agent</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {agent.name} and{" "}
        {conversationCount === 1 ? "its 1 conversation" : `its ${conversationCount} conversations`} will be
        deleted. This can&apos;t be undone.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="destructive"
        className="mt-4"
        disabled={isDeleting}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 />
        Delete agent
      </Button>

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
    </section>
  );
}
