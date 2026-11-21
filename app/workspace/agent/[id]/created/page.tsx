import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Play } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { HeroWash } from "@/components/custom/design/HeroWash";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { describeSchedule } from "@/lib/schedule/cron";
import { listTasks } from "@/lib/tasks";
import { listToolSettings } from "@/lib/tools";

/** "Your agent is ready" (design/reference/19-success.html), shown right after Create agent. */
export default async function AgentCreatedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();
  const agent = await getOwnedAgent(user.id, id);
  if (!agent) notFound();

  const [tools, tasks] = await Promise.all([listToolSettings(agent), listTasks(agent.id, user.id)]);
  const enabled = tools.filter((tool) => tool.enabled).map((tool) => tool.key);
  const scheduled = tasks.find((task) => task.enabled && task.trigger === "schedule" && task.schedule);

  const message = scheduled?.schedule
    ? `${agent.name} will run ${describeSchedule(scheduled.schedule).replace(/^Every/, "every")}. Its results will land in your Inbox.`
    : `${agent.name} is ready to chat. Give it a schedule and it will run on its own, reporting to your Inbox.`;

  return (
    <div className="relative flex min-h-[calc(100svh-3.5rem)] items-center justify-center overflow-hidden p-6 md:min-h-svh">
      <HeroWash className="top-0 h-full" />
      <section
        role="status"
        className="relative flex w-full max-w-[520px] flex-col items-center gap-4 rounded-2xl border bg-card px-8 py-12 text-center shadow-lg"
      >
        <Image src="/mascot.svg" alt="" width={140} height={140} className="size-[140px]" />
        <h1 className="font-display text-[32px] leading-9 font-semibold tracking-[-0.02em]">
          Your agent is ready
        </h1>
        <p className="text-body-l text-muted-foreground">{message}</p>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-md bg-muted px-3.5 py-2.5">
          <span className="size-7 shrink-0">
            <AgentAvatar seed={agent.avatarSeed} name="" />
          </span>
          <span className="font-medium">{agent.name}</span>
          {enabled.map((key) => (
            <code
              key={key}
              className="rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground"
            >
              {key}
            </code>
          ))}
        </div>
        <div className="flex w-full flex-col justify-center gap-3 pt-2 sm:w-auto sm:flex-row">
          <Link href={`/workspace/agent/${agent.id}`} className={buttonVariants()}>
            <Play className="size-3.5 fill-current" />
            Run it now
          </Link>
          <Link href="/workspace/agents" className={buttonVariants({ variant: "outline" })}>
            Go to agents
          </Link>
        </div>
      </section>
    </div>
  );
}
