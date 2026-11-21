import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageWrap } from "@/components/custom/design/HeroWash";
import { TemplateGrid } from "@/components/custom/marketplace/TemplateGrid";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { MOCK_FEATURED_TEMPLATE, MOCK_TEMPLATES } from "@/lib/mock-data";

/**
 * Marketplace (design/reference/16-marketplace.html): templates to start an agent from.
 * TODO(backend): templates are MOCK_TEMPLATES in lib/mock-data.ts; "Use template" opens
 * Create agent filled in from one, which is real.
 */
export default function MarketplacePage() {
  const featured = MOCK_TEMPLATES.find((template) => template.key === MOCK_FEATURED_TEMPLATE.key);

  return (
    <PageWrap width="wide">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Marketplace</h1>
        <p className="text-muted-foreground">Start from an agent that already works, then make it yours.</p>
      </div>

      <section className="relative flex flex-col items-stretch gap-8 overflow-hidden rounded-2xl bg-accent p-8 md:flex-row md:items-center">
        <div className="relative flex flex-1 flex-col gap-3">
          <Badge variant="run" className="self-start bg-card">
            Featured
          </Badge>
          <h2 className="font-display text-[32px] leading-9 font-semibold tracking-[-0.02em]">
            {MOCK_FEATURED_TEMPLATE.title}
          </h2>
          <p className="max-w-[460px] text-body-l text-muted-foreground">{MOCK_FEATURED_TEMPLATE.pitch}</p>
          <div className="flex gap-2">
            <Link href={`/workspace/create-agent?template=${MOCK_FEATURED_TEMPLATE.key}`} className={buttonVariants()}>
              Use template
            </Link>
            <Link href="#templates" className={buttonVariants({ variant: "outline" })}>
              Preview
            </Link>
          </div>
        </div>
        {featured && (
          <span className="relative hidden size-40 shrink-0 md:block">
            <AgentAvatar seed={featured.avatarSeed} name="" />
          </span>
        )}
      </section>

      <TemplateGrid templates={MOCK_TEMPLATES} />
    </PageWrap>
  );
}
