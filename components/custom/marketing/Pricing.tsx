"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Monitor, Plus, X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PRICING_FAQ, PRICING_PLANS, planLimits, type PricingPlan } from "@/lib/pricing";
import { cn } from "@/lib/utils";

type Period = "month" | "year";

/**
 * The landing page's pricing section (design/reference/23-landing-pricing.html): a
 * Monthly / Yearly switch, the three plans, what counts as VM time, and a short FAQ.
 * Client-side only for the switch.
 */
export function Pricing({ appHref }: { appHref: string }) {
  const [period, setPeriod] = useState<Period>("month");

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="relative mx-auto flex max-w-[1080px] scroll-mt-6 flex-col items-center gap-7 px-6 pt-8 pb-24"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h2
          id="pricing-title"
          className="font-display text-[32px] leading-9 font-semibold tracking-[-0.02em] text-balance md:text-[40px] md:leading-[44px]"
        >
          Simple pricing
        </h2>
        <p className="max-w-[560px] text-body-l text-muted-foreground">
          Start free. Upgrade when your agents do more: more of them, more often, and more time on their own VM.
        </p>
      </div>

      <div role="group" aria-label="Billing period" className="inline-flex gap-1 rounded-full bg-muted p-1">
        {(["month", "year"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 font-medium text-muted-foreground",
              period === value && "bg-card text-foreground shadow-xs",
            )}
          >
            {value === "month" ? "Monthly" : "Yearly"}
            {value === "year" && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] text-accent-foreground">
                2 months free
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid w-full max-w-[440px] grid-cols-1 items-stretch gap-5 lg:max-w-none lg:grid-cols-3">
        {PRICING_PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} period={period} appHref={appHref} />
        ))}
      </div>

      <div className="flex max-w-[720px] items-start gap-3 rounded-lg border bg-card px-[18px] py-3.5 text-body-s">
        <Monitor className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <p>
          <span className="font-semibold">What counts as VM time?</span>{" "}
          <span className="text-muted-foreground">
            Only the minutes an agent&apos;s VM is actually running. It stops by itself after 10 idle minutes and keeps
            its files, and a stopped VM doesn&apos;t count.
          </span>
        </p>
      </div>

      <div className="flex w-full max-w-[720px] flex-col">
        {PRICING_FAQ.map((item) => (
          <details key={item.q} className="group border-b px-1 py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
              {item.q}
              <Plus className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true" />
            </summary>
            <p className="mt-2 text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>

      <p className="text-caption font-medium text-muted-foreground">Prices in US dollars. Taxes may apply.</p>
    </section>
  );
}

function PlanCard({ plan, period, appHref }: { plan: PricingPlan; period: Period; appHref: string }) {
  const free = plan.monthly === 0;
  const price = period === "year" ? plan.yearly : plan.monthly;
  const note = free
    ? "No card needed"
    : period === "year"
      ? `$${plan.yearly * 12} billed yearly`
      : "Billed monthly";

  return (
    <article
      aria-label={`${plan.name} plan`}
      className={cn(
        "relative flex flex-col gap-5 rounded-xl border bg-card p-7 shadow-sm",
        plan.popular && "border-[1.5px] border-brand shadow-lg",
      )}
    >
      {plan.popular && (
        <span className="absolute -top-3 left-7 rounded-full bg-brand-fill px-2.5 py-[3px] text-caption font-semibold text-white">
          Most popular
        </span>
      )}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-h3 font-semibold">{plan.name}</h3>
        <p className="text-body-s text-muted-foreground">{plan.blurb}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[44px] leading-none font-bold tracking-[-0.02em] tabular-nums">${price}</span>
          <span className="text-muted-foreground">{free ? "forever" : "/ month"}</span>
        </div>
        <span className="min-h-4 text-caption text-muted-foreground">{note}</span>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-2">
        {planLimits(plan).map((limit) => (
          <div key={limit.label} className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2.5">
            <dt className="order-2 text-caption text-muted-foreground">{limit.label}</dt>
            <dd className="order-1 m-0 font-semibold tabular-nums">{limit.value}</dd>
          </div>
        ))}
      </dl>

      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-body-s">
        {plan.features.map((feature) => (
          <li
            key={feature.text}
            className={cn("flex items-start gap-2.5", !feature.included && "text-subtle-foreground")}
          >
            {feature.included ? (
              <Check className="mt-0.5 size-4 shrink-0 text-[#16A34A] dark:text-[#22C55E]" aria-hidden="true" />
            ) : (
              <X className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {feature.text}
              {!feature.included && <span className="sr-only"> (not included)</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex-1" />
      {/* TODO(backend): billing is Phase 7; until then every plan button opens the app. */}
      <Link
        href={appHref}
        className={cn(
          buttonVariants({ variant: free ? "outline" : plan.popular ? "brand" : "default" }),
          "h-11 w-full",
        )}
      >
        {plan.cta}
      </Link>
    </article>
  );
}
