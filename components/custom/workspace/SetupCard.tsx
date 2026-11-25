"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, Check, Globe, Layers, Loader2, Mail, Monitor, NotebookText, Sparkles } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { setAgentVm, updateAgentTool } from "@/app/workspace/actions";
import type { SetupRecommendation } from "@/lib/agent-guide";
import { cn } from "@/lib/utils";

const ICONS: Record<SetupRecommendation["id"], typeof Globe> = {
  web: Globe,
  vm: Monitor,
  schedule: CalendarClock,
  gmail: Mail,
  notion: NotebookText,
  jira: Layers,
};

/**
 * "Suggested setup": what this agent's job needs and doesn't have yet (lib/agent-guide.ts),
 * each with the one action that fixes it. Shown after creating an agent and in its empty
 * chat; an item goes away once it's done (the page refreshes and the rules run again).
 */
export function SetupCard({
  agentId,
  agentName,
  recommendations,
  className,
}: {
  agentId: string;
  agentName: string;
  recommendations: SetupRecommendation[];
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (recommendations.length === 0) return null;

  const run = (rec: SetupRecommendation) => {
    const action = rec.action;
    if (action.kind === "link") return;
    setBusy(rec.id);
    setError(null);
    startTransition(async () => {
      const results =
        action.kind === "vm"
          ? [await setAgentVm(agentId, { enabled: true, trustCode: false })]
          : await Promise.all(
              action.tools.map((tool) =>
                updateAgentTool(agentId, { tool, enabled: true, connectionId: null, approval: "never" }),
              ),
            );
      const failed = results.find((result) => result?.error);
      setBusy(null);
      if (failed?.error) {
        setError(failed.error);
        return;
      }
      setDone((current) => new Set(current).add(rec.id));
      // The rules run again on the server: what's done drops off, the rest stays.
      router.refresh();
    });
  };

  return (
    <section
      aria-label={`Suggested setup for ${agentName}`}
      className={cn("flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-left shadow-sm", className)}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-body font-semibold">Suggested setup</h2>
        <span className="text-body-s text-muted-foreground">from what {agentName} is for</span>
      </div>
      <ul className="m-0 flex list-none flex-col divide-y p-0">
        {recommendations.map((rec) => {
          const Icon = ICONS[rec.id];
          const finished = done.has(rec.id);
          return (
            <li key={rec.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-1 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-brand">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="flex min-w-[200px] flex-1 flex-col">
                <span className="font-medium">{rec.title}</span>
                <span className="text-body-s text-muted-foreground">{rec.why}</span>
              </span>
              {finished ? (
                <span className="inline-flex items-center gap-1.5 text-body-s font-medium text-[#15803D] dark:text-[#4ADE80]">
                  <Check className="size-4" aria-hidden="true" />
                  Done
                </span>
              ) : rec.action.kind === "link" ? (
                <Link href={rec.action.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {rec.action.label}
                  <ArrowRight />
                </Link>
              ) : (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(rec)}>
                  {busy === rec.id && <Loader2 className="animate-spin" />}
                  {rec.action.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
