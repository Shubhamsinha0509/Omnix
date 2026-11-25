import { Check } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { ComingSoonButton } from "@/components/custom/design/ComingSoonButton";
import { PageWrap } from "@/components/custom/design/HeroWash";
import { UsageMeter } from "@/components/custom/design/UsageMeter";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { getCurrentUser } from "@/lib/auth";
import { MOCK_CURRENT_PLAN_ID, MOCK_INVOICES } from "@/lib/mock-data";
import { PRICING_PLANS, getPlan, type PlanAllowances } from "@/lib/pricing";
import { getMonthlyUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-body-s">
      <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
      {children}
    </li>
  );
}

/** "1 scheduled task", "Unlimited scheduled tasks". */
function scheduledTasks(allowance: PlanAllowances["scheduledTasks"]) {
  if (allowance === "unlimited") return "Unlimited scheduled tasks";
  return `${allowance} scheduled task${allowance === 1 ? "" : "s"}`;
}

/**
 * Usage & billing (design/reference/17-usage-billing.html). Usage is real, from the run
 * log; the plans and their allowances are the same ones the landing page shows
 * (lib/pricing.ts). Which plan you're on, upgrades and invoices are still mock
 * (MOCK_CURRENT_PLAN_ID, MOCK_INVOICES in lib/mock-data.ts).
 */
export default async function UsagePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const usage = await getMonthlyUsage(user.id);

  const current = getPlan(MOCK_CURRENT_PLAN_ID);
  const allowances = current.allowances;
  const percent = Math.min(100, (usage.tokens / allowances.tokensPerMonth) * 100);
  const top = usage.byAgent[0]?.tokens ?? 0;

  return (
    <PageWrap>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h1 font-semibold tracking-[-0.015em]">Usage &amp; billing</h1>
        <p className="text-muted-foreground">Track usage and manage your plan.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-caption font-medium text-muted-foreground">Current plan</span>
              <span className="font-display text-h1 font-semibold tracking-[-0.015em]">{current.name}</span>
            </div>
            {/* TODO(backend): billing. */}
            <ComingSoonButton variant="brand" message="Billing is coming soon">
              Upgrade plan
            </ComingSoonButton>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            <Feature>{allowances.tokensPerMonth.toLocaleString()} tokens a month</Feature>
            <Feature>{allowances.webSearchesPerMonth.toLocaleString()} web searches a month</Feature>
            <Feature>
              {allowances.agents} agent{allowances.agents === 1 ? "" : "s"}
            </Feature>
            <Feature>{scheduledTasks(allowances.scheduledTasks)}</Feature>
          </ul>
        </section>

        <section className="flex flex-col gap-3.5 rounded-lg border bg-card p-6 shadow-sm">
          <span className="text-caption font-medium text-muted-foreground">Tokens this month</span>
          <div className="flex items-baseline">
            <span className="font-display text-h1 font-semibold tracking-[-0.015em]">{Math.round(percent)}%</span>
            <span className="flex-1" />
            <span className="text-body-s text-muted-foreground">
              {usage.tokens.toLocaleString()} of {allowances.tokensPerMonth.toLocaleString()}
            </span>
          </div>
          <UsageMeter value={percent} label="Tokens used" />
          <div className="flex justify-between text-body-s text-muted-foreground">
            <span>Resets {format(usage.resetsAt, "MMM d")}</span>
            <span>
              Web searches: {usage.webSearches} of {allowances.webSearchesPerMonth.toLocaleString()}
            </span>
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">Usage by agent</h2>
        {usage.byAgent.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
            No runs yet this month.
          </p>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {usage.byAgent.map((agent) => (
              <div key={agent.id} className="flex min-h-[52px] items-center gap-3 px-4 py-3">
                <span className="size-6 shrink-0">
                  <AgentAvatar seed={agent.avatarSeed} name="" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
                <span className="hidden w-[200px] md:block">
                  <UsageMeter value={top ? (agent.tokens / top) * 100 : 0} label={`${agent.name} share of tokens`} />
                </span>
                <span className="w-16 text-right font-mono text-caption">{agent.tokens.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">Plans</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PRICING_PLANS.map((plan) => {
            const isCurrent = plan.id === current.id;
            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border bg-card p-6",
                  plan.popular && "border-brand",
                )}
              >
                <div className="flex items-center">
                  <span className="flex-1 text-h3 font-semibold">{plan.name}</span>
                  {isCurrent ? (
                    <Badge variant="neutral">Current</Badge>
                  ) : (
                    <span className="font-semibold">
                      {plan.monthly === 0 ? "Free" : `$${plan.monthly} / month`}
                    </span>
                  )}
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {plan.features
                    .filter((feature) => feature.included)
                    .map((feature) => (
                      <Feature key={feature.text}>{feature.text}</Feature>
                    ))}
                </ul>
                <div className="flex-1" />
                {!isCurrent && (
                  <ComingSoonButton variant="brand" className="self-start" message="Billing is coming soon">
                    {plan.cta}
                  </ComingSoonButton>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">Invoices</h2>
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-muted-foreground">
            {MOCK_INVOICES.length === 0 ? "No invoices yet. You’re on the free plan." : null}
          </p>
        </div>
      </section>
    </PageWrap>
  );
}
