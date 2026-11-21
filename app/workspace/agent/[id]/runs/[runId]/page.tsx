import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, eq, lte } from "drizzle-orm";
import { ArrowLeft, Check, Pause, Server, Square, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageWrap } from "@/components/custom/design/HeroWash";
import { Spinner } from "@/components/custom/design/RunStepRow";
import { StatusBadge, type AgentStatus } from "@/components/custom/design/StatusBadge";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { AutoRefresh } from "@/components/custom/workspace/AutoRefresh";
import { Markdown } from "@/components/custom/workspace/Markdown";
import RunTimeline, { buildRunRows } from "@/components/custom/workspace/RunTimeline";
import { db, runs } from "@/db";
import { getRunDetail } from "@/lib/agent/runs";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";

type Props = { params: Promise<{ id: string; runId: string }> };

const LIVE = ["queued", "running", "waiting_approval"];

/** How a run's status reads as a badge. */
function badgeFor(status: string): { status: AgentStatus; label: string } {
  switch (status) {
    case "queued":
      return { status: "running", label: "Queued" };
    case "running":
      return { status: "running", label: "Running" };
    case "waiting_approval":
      return { status: "paused", label: "Waiting for you" };
    case "succeeded":
      return { status: "active", label: "Done" };
    case "failed":
      return { status: "error", label: "Failed" };
    default:
      return { status: "draft", label: "Cancelled" };
  }
}

/** "00:01:24" */
function clock(from: Date, to: Date) {
  const seconds = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

const TRIGGER: Record<string, string> = {
  manual: "Manually",
  schedule: "On schedule",
  chat: "From chat",
  event: "From an event",
};

/** One run, live or finished (design/reference/13-live-run.html). */
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

  // "Run #12": this agent's runs up to and including this one.
  const [{ total: number }] = await db
    .select({ total: count() })
    .from(runs)
    .where(and(eq(runs.agentId, agent.id), lte(runs.startedAt, run.startedAt)));

  const live = LIVE.includes(run.status);
  const end = run.finishedAt ?? new Date();
  const elapsed = clock(run.startedAt, end);
  const badge = badgeFor(run.status);
  const { rows, reply } = buildRunRows(steps, run);
  const toolsUsed = [...new Set(steps.map((step) => step.tool).filter((tool): tool is string => Boolean(tool)))];
  const started = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(run.startedAt);

  return (
    <PageWrap width="wide">
      {live && <AutoRefresh />}
      <Link
        href="/workspace/agents"
        className="flex items-center gap-2 self-start text-body-s text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to agents
      </Link>

      <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start">
        {/* The agent and the run's facts */}
        <aside className="flex shrink-0 flex-col gap-5 rounded-lg border bg-card p-6 shadow-sm md:w-[300px]">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <span className="size-[72px]">
              <AgentAvatar seed={agent.avatarSeed} name="" />
            </span>
            <h1 className="font-sans text-h2 font-semibold tracking-[-0.005em]">{agent.name}</h1>
            <StatusBadge status={badge.status} label={badge.label} />
            <p className="line-clamp-4 text-body-s text-muted-foreground">
              {run.taskName ? `Task: ${run.taskName}` : agent.instructions || "A general assistant."}
            </p>
          </div>

          {live && (
            // TODO(backend): pausing and stopping a run (cancel the Inngest function / abort the stream).
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled title="Coming soon">
                <Pause className="size-4" />
                Pause
              </Button>
              <Button variant="destructive" className="flex-1" disabled title="Coming soon">
                <Square className="size-3.5 fill-current" />
                Stop
              </Button>
            </div>
          )}

          <div className="h-px bg-border" />

          <dl className="m-0 flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <dt className="text-caption font-medium text-muted-foreground">Environment</dt>
              <dd className="m-0 flex items-center gap-2">
                <Server className="size-4 text-muted-foreground" />
                Shared runtime
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption font-medium text-muted-foreground">{live ? "Elapsed" : "Took"}</dt>
              <dd className="m-0 font-mono text-[20px] leading-7">{elapsed}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption font-medium text-muted-foreground">Started</dt>
              <dd className="m-0 text-body-s">
                {TRIGGER[run.trigger] ?? run.trigger} · {started}
              </dd>
            </div>
            <div className="flex flex-col gap-1.5">
              <dt className="text-caption font-medium text-muted-foreground">Tools in use</dt>
              <dd className="m-0 flex flex-wrap gap-1.5">
                {toolsUsed.length ? (
                  toolsUsed.map((tool) => (
                    <code key={tool} className="rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
                      {tool}
                    </code>
                  ))
                ) : (
                  <span className="text-body-s text-muted-foreground">None</span>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-caption font-medium text-muted-foreground">Tokens</dt>
              <dd className="m-0 text-body-s">
                {run.inputTokens.toLocaleString()} in · {run.outputTokens.toLocaleString()} out
              </dd>
            </div>
          </dl>
        </aside>

        {/* The run log */}
        <section
          aria-label="Run log"
          className="flex min-h-[640px] min-w-0 flex-1 flex-col gap-2 rounded-xl bg-run-panel p-5 text-run-panel-foreground shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between border-b border-white/[0.08] px-1 pt-1 pb-3">
            <span className="font-semibold">Run #{number}</span>
            <span className="font-mono text-caption text-run-panel-muted">{elapsed}</span>
          </div>

          <RunTimeline rows={rows} startedAt={run.startedAt} />

          {run.status === "waiting_approval" && (
            <p className="mt-3 rounded-lg bg-warning/15 px-4 py-3 text-body-s">
              This run is waiting for your approval. Decide it in your{" "}
              <Link href="/workspace/inbox" className="text-[#A5ABFB] hover:underline">
                Inbox
              </Link>
              {run.conversationId ? " or in the chat" : ""} and the agent will carry on.
            </p>
          )}

          {reply && (
            <div className="mt-3 flex flex-col gap-3.5 rounded-lg bg-run-panel-raised p-5">
              <p className="font-semibold">
                {run.taskName ?? "Reply"}{" "}
                <span className="text-caption font-normal text-run-panel-muted">
                  · {live ? "drafting" : "final"}
                </span>
              </p>
              {/* The agent's own reply, rendered as the chat renders it (Markdown, never raw HTML).
                  `dark` keeps tables and code legible on the panel, which is dark in both themes. */}
              <div className="dark max-h-[480px] overflow-auto text-run-panel-foreground">
                <Markdown content={reply} className="text-body-s" />
              </div>
            </div>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-3 rounded-lg bg-run-panel-raised py-2 pr-2 pl-4">
            {live ? (
              <>
                <Spinner />
                <span className="flex-1 text-run-panel-muted">
                  {run.status === "waiting_approval" ? "Waiting for your decision…" : "Agent is working…"}
                </span>
              </>
            ) : run.status === "failed" ? (
              <>
                <TriangleAlert className="size-4 text-destructive" />
                <span className="flex-1 text-run-panel-muted">{run.error ?? "The run failed."}</span>
              </>
            ) : (
              <>
                <Check className="size-4 text-[#22C55E]" />
                <span className="flex-1 text-run-panel-muted">Run finished in {elapsed}</span>
              </>
            )}
            {run.conversationId ? (
              <Link href={`/workspace/agent/${agent.id}?c=${run.conversationId}`} className="flex h-10 items-center rounded-md bg-brand-fill px-4 font-semibold text-white">
                Open chat
              </Link>
            ) : (
              <Link href={`/workspace/agent/${agent.id}/runs`} className="flex h-10 items-center rounded-md bg-brand-fill px-4 font-semibold text-white">
                All runs
              </Link>
            )}
          </div>
        </section>
      </div>
    </PageWrap>
  );
}
