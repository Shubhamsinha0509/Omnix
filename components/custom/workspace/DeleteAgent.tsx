"use client";

import { useState, useTransition } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

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
 * The "Delete savvyy" block (10-chat-config-settings) with its confirmation. Shared by the
 * settings page and the configuration drawer, so both delete the same way.
 */
export function DeleteAgent({
  agent,
  conversationCount,
}: {
  agent: { id: string; name: string };
  /** How many conversations go with it, for the confirmation. */
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
    <section className="flex flex-col gap-2.5 rounded-lg border border-destructive p-4">
      <h3 className="font-semibold text-destructive">Delete {agent.name}</h3>
      <p className="text-body-s text-muted-foreground">
        Removes the agent, its schedule and chat history. Connected accounts stay connected.
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="self-start"
        disabled={isDeleting}
        onClick={() => setConfirmOpen(true)}
      >
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
              {agent.name}, its schedule and{" "}
              {conversationCount === 1 ? "its 1 chat" : `its ${conversationCount} chats`} will be
              permanently deleted. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={isDeleting}>
              {isDeleting && <Loader2 className="animate-spin" />}
              {isDeleting ? "Deleting…" : "Delete agent"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
