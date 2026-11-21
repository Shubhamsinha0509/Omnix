import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import AgentNav from "@/components/custom/workspace/AgentNav";
import { RunStatusBadge, duration, triggerLabel } from "@/components/custom/workspace/RunStatus";
import RunTimeline from "@/components/custom/workspace/RunTimeline";
import { getRunDetail } from "@/lib/agent/runs";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";

type Props = { params: Promise<{ id: string; runId: string }> };

/** One run's timeline — what the agent did, in order, with what each tool returned. */
export default async function RunPage({ params }: Props) {
  const { id, runId } = await params;

  const user = await getCurrentUser();
  if (!user) notFound();

  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  const detail = await getRunDetail(runId, user.id);
  // The run has to be this user's *and* belong to the agent whose page this is.
  if (!detail || detail.run.agentId !== agent.id) notFound();

  const { run, steps } = detail;

  return (
    <div className="flex h-svh flex-col">
      <AgentNav agent={agent} active="runs" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <Link
            href={`/workspace/agent/${agent.id}/runs`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All runs
          </Link>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">{run.taskName ?? triggerLabel(run.trigger)}</h2>
            <RunStatusBadge status={run.status} />
          </div>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <div>
              Started{" "}
              {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
                run.startedAt,
              )}
            </div>
            <div>Took {duration(run.startedAt, run.finishedAt)}</div>
            <div>
              {run.inputTokens} in / {run.outputTokens} out tokens
            </div>
            <div>Triggered by {triggerLabel(run.trigger).toLowerCase()}</div>
            {run.conversationId && (
              <Link
                href={`/workspace/agent/${agent.id}?c=${run.conversationId}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Open the chat
              </Link>
            )}
            {run.taskId && (
              <Link
                href={`/workspace/agent/${agent.id}/tasks`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Open the task
              </Link>
            )}
          </dl>

          {run.error && (
            <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {run.error}
            </p>
          )}

          {run.status === "waiting_approval" && (
            <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              This run is waiting for your approval. Decide it in your{" "}
              <Link href="/workspace/inbox" className="underline underline-offset-4">
                inbox
              </Link>
              {run.conversationId ? " or in the chat" : ""} and the agent will carry on.
            </p>
          )}

          <RunTimeline steps={steps} />
        </div>
      </div>
    </div>
  );
}
