import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, ListOrdered } from "lucide-react";

import AgentNav from "@/components/custom/workspace/AgentNav";
import { RunStatusBadge, duration, triggerLabel } from "@/components/custom/workspace/RunStatus";
import { listRuns } from "@/lib/agent/runs";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";

/**
 * The Runs tab: every run this agent has made, chat turns included.
 *
 * It is read straight from `runs` and `run_steps`, which have been written on every turn
 * since Phase 2 — this page is the first time anyone can see them without SQL.
 */
export default async function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) notFound();

  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  const runs = await listRuns(agent.id, user.id);

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col md:h-svh">
      <AgentNav agent={agent} active="runs" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <h2 className="font-semibold">Runs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything {agent.name} has done — a chat turn, a scheduled task, or a run you started
            — with the tools it used and what they returned.
          </p>

          {runs.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
              <ListOrdered className="size-8 text-muted-foreground" />
              <h3 className="font-semibold">No runs yet</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                Send {agent.name} a message, or give it a task, and each run will be recorded here.
              </p>
            </div>
          ) : (
            <ul className="mt-6 divide-y rounded-xl border">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/workspace/agent/${agent.id}/runs/${run.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <RunStatusBadge status={run.status} />
                        <span className="text-sm font-medium">
                          {run.taskName ?? triggerLabel(run.trigger)}
                        </span>
                        {run.taskName && (
                          <span className="text-xs text-muted-foreground">
                            {triggerLabel(run.trigger)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDistanceToNow(run.startedAt, { addSuffix: true })} ·{" "}
                        {duration(run.startedAt, run.finishedAt)} · {run.steps}{" "}
                        {run.steps === 1 ? "step" : "steps"} ·{" "}
                        {run.inputTokens + run.outputTokens} tokens
                      </p>
                      {run.error && (
                        <p className="mt-1 line-clamp-1 text-xs text-destructive">{run.error}</p>
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
