/**
 * Omnix's plans, as the landing page shows them (design/reference/23-landing-pricing.html)
 * and as the app measures usage against them (`/workspace/usage`, the sidebar's token
 * meter).
 *
 * A starting set, approved for the page: the numbers still have to be checked against what
 * they cost us (E2B's per-second VM price, the model's token price) before they are real,
 * and nothing enforces them yet. Plans, limits and billing are Phase 7
 * (docs/08-roadmap.md). The one place a plan is written down: `allowances` holds the
 * numbers, and the landing page's limit tiles are formatted from them by `planLimits`, so
 * a screen can't show an allowance the plan doesn't have. Which plan a user is on is still
 * mock (`MOCK_CURRENT_PLAN_ID` in lib/mock-data.ts).
 */

export type PlanId = "free" | "pro" | "power";

export type PlanLimit = { value: string; label: string };

/**
 * What a plan allows in a month, in the units the run log counts (lib/usage.ts). VM time
 * is minutes a VM is actually running; see the landing page's note.
 */
export type PlanAllowances = {
  agents: number;
  scheduledTasks: number | "unlimited";
  tokensPerMonth: number;
  /** Not on the landing page; shown on the usage page and follows the token tiers. */
  webSearchesPerMonth: number;
  vmMinutesPerMonth: number;
};

export type PricingPlan = {
  id: PlanId;
  name: "Free" | "Pro" | "Power";
  /** One line under the name: who it's for. */
  blurb: string;
  /** US dollars a month, billed monthly. 0 for Free. */
  monthly: number;
  /** US dollars a month when billed yearly (two months free). */
  yearly: number;
  popular?: boolean;
  allowances: PlanAllowances;
  /** Included; `included: false` is greyed out with an ×, so the step up is visible. */
  features: { text: string; included: boolean }[];
  cta: string;
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    blurb: "Try Omnix with a couple of agents.",
    monthly: 0,
    yearly: 0,
    allowances: {
      agents: 2,
      scheduledTasks: 1,
      tokensPerMonth: 100_000,
      webSearchesPerMonth: 100,
      vmMinutesPerMonth: 30,
    },
    features: [
      { text: "Gmail, web search and browsing", included: true },
      { text: "Results in your in-app Inbox", included: true },
      { text: "Live run panel and VM screen", included: true },
      { text: "Slack, Notion and Jira", included: false },
      { text: "Community support", included: true },
    ],
    cta: "Start free",
  },
  {
    id: "pro",
    name: "Pro",
    blurb: "For handing real, daily work to agents.",
    monthly: 19,
    yearly: 15,
    popular: true,
    allowances: {
      agents: 10,
      scheduledTasks: "unlimited",
      tokensPerMonth: 2_000_000,
      webSearchesPerMonth: 2_000,
      vmMinutesPerMonth: 20 * 60,
    },
    features: [
      { text: "Everything in Free", included: true },
      { text: "Slack, Notion and Jira", included: true },
      { text: "Results by email as well", included: true },
      { text: "Faster, more capable models", included: true },
      { text: "Email support", included: true },
    ],
    cta: "Upgrade to Pro",
  },
  {
    id: "power",
    name: "Power",
    blurb: "For heavy automation and long VM sessions.",
    monthly: 49,
    yearly: 39,
    allowances: {
      agents: 50,
      scheduledTasks: "unlimited",
      tokensPerMonth: 10_000_000,
      webSearchesPerMonth: 10_000,
      vmMinutesPerMonth: 100 * 60,
    },
    features: [
      { text: "Everything in Pro", included: true },
      { text: "The most capable models", included: true },
      { text: "Longer VM sessions", included: true },
      { text: "Priority support", included: true },
    ],
    cta: "Go Power",
  },
];

export function getPlan(id: PlanId): PricingPlan {
  const plan = PRICING_PLANS.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

const plural = (n: number, one: string) => (n === 1 ? one : `${one}s`);

/** 100_000 → "100K", 2_000_000 → "2M". */
const tokens = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`);

/** 30 → "30 min", 1_200 → "20 hours". */
const vmTime = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${minutes / 60} ${plural(minutes / 60, "hour")}`;

/** The four tiles under a plan's price on the landing page, from its allowances. */
export function planLimits({ allowances }: PricingPlan): PlanLimit[] {
  const { agents, scheduledTasks, tokensPerMonth, vmMinutesPerMonth } = allowances;
  return [
    { value: String(agents), label: plural(agents, "agent") },
    {
      value: scheduledTasks === "unlimited" ? "Unlimited" : String(scheduledTasks),
      label: scheduledTasks === "unlimited" ? "scheduled tasks" : plural(scheduledTasks, "scheduled task"),
    },
    { value: tokens(tokensPerMonth), label: "AI tokens / month" },
    { value: vmTime(vmMinutesPerMonth), label: "VM time / month" },
  ];
}

export const PRICING_FAQ = [
  {
    q: "What happens when I reach a limit?",
    a: "Your agents pause the work that needs more, and you get a note in your Inbox. Nothing is deleted. Upgrade, or wait for next month's allowance.",
  },
  {
    q: "Do I need my own API keys?",
    a: "No. Models, search and VMs are included in every plan. You only connect the accounts you want agents to use, like Gmail or Slack.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. You keep your plan until the end of the period you paid for, then move to Free. Your agents and their history stay.",
  },
];
