"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button, buttonVariants } from "@/components/ui/button";
import { AgentFields, type AgentDraft } from "@/components/custom/workspace/AgentFields";
import { randomAvatarSeed } from "@/components/custom/workspace/AgentAvatar";
import { createAgent } from "../actions";

const CreateAgentPage = () => {
  // The seed is empty until the page loads in the browser, so server and browser HTML match.
  const [draft, setDraft] = useState<AgentDraft>({ name: "", instructions: "", avatarSeed: "" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Start every new agent with a random avatar.
  useEffect(() => setDraft((current) => ({ ...current, avatarSeed: randomAvatarSeed() })), []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      // On success the server redirects to the new agent's page.
      const result = await createAgent(draft);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Create New Agent</h1>
        <p className="mt-1.5 text-muted-foreground">
          Customize your agent and give it a clear purpose.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <AgentFields draft={draft} onChange={setDraft} disabled={isPending} />

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Link href="/workspace" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Cancel
          </Link>
          <Button type="submit" size="lg" disabled={!draft.name.trim() || !draft.avatarSeed || isPending}>
            {isPending && <Loader2 className="animate-spin" />}
            {isPending ? "Creating..." : "Create Agent"}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateAgentPage;
