import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { HeroWash, PageWrap } from "@/components/custom/design/HeroWash";
import { CreateAgentForm } from "@/components/custom/workspace/CreateAgentForm";
import { randomAvatarSeed } from "@/components/custom/workspace/AgentAvatar";
import { CHAT_MODEL } from "@/lib/ai";
import { LIMITS } from "@/lib/agent/runner";
import { modelLabel } from "@/lib/format";
import { MOCK_TEMPLATES } from "@/lib/mock-data";

/** Create agent (design/reference/11-create-agent.html). */
export default async function CreateAgentPage({
  searchParams,
}: {
  /** `?template=<key>` (from Marketplace) starts the form from that template. */
  searchParams: Promise<{ template?: string }>;
}) {
  const { template: key } = await searchParams;
  const template = MOCK_TEMPLATES.find((candidate) => candidate.key === key);

  return (
    <div className="relative overflow-hidden">
      <HeroWash />
      <PageWrap width="narrow">
        <Link
          href="/workspace/agents"
          className="flex items-center gap-2 self-start text-body-s text-muted-foreground no-underline hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Agents
        </Link>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Create agent</h1>
          <p className="text-body-l text-muted-foreground">
            Give it a name, a job, and the tools it&apos;s allowed to use.
          </p>
        </div>
        {/* A fresh avatar for every visit, chosen here so server and browser HTML match. */}
        <CreateAgentForm
          initialDraft={{
            name: template?.name ?? "",
            instructions: template?.instructions ?? "",
            avatarSeed: template?.avatarSeed ?? randomAvatarSeed(),
          }}
          model={{ id: CHAT_MODEL, label: modelLabel(CHAT_MODEL) }}
          limits={{ steps: LIMITS.maxIterations, toolCalls: LIMITS.maxToolCalls }}
        />
      </PageWrap>
    </div>
  );
}
