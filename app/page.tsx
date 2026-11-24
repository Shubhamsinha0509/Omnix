import Link from "next/link";
import { CalendarDays, FileText, Layers, Mail, MessageSquare } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { HeroWash } from "@/components/custom/design/HeroWash";
import { RunStepRow } from "@/components/custom/design/RunStepRow";
import { Logo } from "@/components/custom/shell/Logo";
import { ThemeToggle } from "@/components/custom/shell/ThemeToggle";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { cn } from "@/lib/utils";

const APP_HREF = "/workspace";

const NAV = [
  { label: "Features", href: "#how" },
  { label: "How it works", href: "#how" },
  { label: "Integrations", href: "#tools" },
  { label: "Docs", href: "#how" },
];

const TOOLS = [
  { label: "Gmail", icon: Mail },
  { label: "Slack", icon: MessageSquare },
  { label: "Notion", icon: FileText },
  { label: "Jira", icon: Layers },
  { label: "Calendar", icon: CalendarDays },
];

const STEPS = [
  { title: "Create an agent", text: "Name it, pick a blob, and write what it should do in plain words." },
  { title: "Connect your tools", text: "Gmail, Slack, Notion and Jira. You choose which actions it may take." },
  {
    title: "Run it now or on a schedule",
    text: "Chat with it, or let it run each morning on its own VM and report back.",
  },
];

/** The purple and teal blobs beside the hero, drawn without their avatar circle. */
function HeroBlob({ kind }: { kind: "purple" | "teal" }) {
  return (
    <svg width="150" height="150" viewBox="0 0 96 96" aria-hidden="true">
      {kind === "purple" ? (
        <g transform="translate(0 4)">
          <path d="M24 76c-7 0-9-11-2-15-4-11 6-19 13-13 2-11 17-13 21-4 9-6 19 3 15 11 8 3 8 15 0 17-3 6-40 6-47 4z" fill="#A88BC9" />
          <circle cx="40" cy="52" r="7" fill="#fff" />
          <circle cx="57" cy="50" r="7" fill="#fff" />
          <circle cx="41" cy="50" r="3" fill="#1F2236" />
          <circle cx="58" cy="48" r="3" fill="#1F2236" />
          <circle cx="48" cy="64" r="2.5" fill="#1F2236" />
        </g>
      ) : (
        <g transform="translate(0 4)">
          <path d="M30 84V48c0-14 8-22 18-22s18 8 18 22v36l-6-5-6 5-6-5-6 5-6-5z" fill="#7FB3A3" />
          <circle cx="62" cy="24" r="5" fill="none" stroke="#7FB3A3" strokeWidth="3" />
          <circle cx="41" cy="50" r="6.5" fill="#fff" />
          <circle cx="56" cy="50" r="6.5" fill="#fff" />
          <circle cx="42" cy="51" r="3" fill="#1F2236" />
          <circle cx="57" cy="51" r="3" fill="#1F2236" />
          <path d="M42 61q6 6 12 0z" fill="#1F2236" />
        </g>
      )}
    </svg>
  );
}

/** The public landing page (design/reference/01-landing.html). */
export default function LandingPage() {
  const big = "h-12 px-6 text-[15px]";
  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <HeroWash className="-top-[120px] h-[820px]" />

      <header className="glass relative mx-4 mt-5 flex items-center gap-6 rounded-xl py-2.5 pr-3 pl-5 shadow-sm md:mx-auto md:max-w-[1040px]">
        <Logo href="/" />
        <nav aria-label="Site" className="mx-auto hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a key={item.label} href={item.href} className="text-muted-foreground no-underline hover:text-foreground">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className={cn(buttonVariants({ variant: "ghost" }), "hidden md:inline-flex")}>
            Sign in
          </Link>
          <Link href={APP_HREF} className={buttonVariants()}>
            Launch app
          </Link>
        </div>
      </header>

      <section className="relative mx-auto flex max-w-[1120px] flex-col items-center gap-6 px-6 pt-24 pb-10 text-center">
        <div className="absolute top-[260px] left-0 hidden md:block">
          <HeroBlob kind="purple" />
        </div>
        <div className="absolute top-[230px] right-0 hidden md:block">
          <HeroBlob kind="teal" />
        </div>
        <h1 className="max-w-[920px] font-display text-[clamp(40px,7vw,76px)] leading-[1.04] font-bold tracking-[-0.02em]">
          Create, Connect &amp; Automate AI Agents Instantly
        </h1>
        <p className="max-w-[600px] text-body-l text-muted-foreground">
          Build personal AI agents, connect them to Gmail, Slack, Notion and Jira, and let them work for
          you: on demand, on a schedule, or on their own virtual machine.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={APP_HREF} className={cn(buttonVariants(), big)}>
            Launch app
          </Link>
          <a href="#how" className={cn(buttonVariants({ variant: "outline" }), big)}>
            See how it works
          </a>
        </div>
      </section>

      {/* A run as it looks in the app: the same RunStepRow, with example steps. */}
      <section className="relative mx-auto max-w-[880px] px-6">
        <div className="flex flex-col gap-2 rounded-xl bg-run-panel p-5 text-left text-run-panel-foreground shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 pb-2">
            <div className="flex items-center gap-2.5">
              <span className="size-7">
                <AgentAvatar seed="green" name="" />
              </span>
              <span className="font-semibold">savvyy</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7C83F5]/20 px-2 py-0.5 text-caption font-medium text-[#C7CBFE]">
                <span className="size-2 rounded-full bg-[#7C83F5]" />
                Running
              </span>
            </div>
            <span className="font-mono text-caption text-run-panel-muted">Weekdays 9:00 · isolated VM</span>
          </div>
          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Example run">
            <RunStepRow state="done" label="Searched Gmail for unread messages" time="0:02" />
            <RunStepRow state="done" label="Read 5 emails and grouped 2 duplicates" time="0:06" />
            <RunStepRow state="current" label="Writing your morning digest…" time="0:09" />
            <RunStepRow state="pending" label="Post digest to #daily in Slack" time={null} />
          </ol>
        </div>
      </section>

      <section id="tools" className="relative flex flex-col items-center gap-5 px-6 pt-16 pb-6">
        <p className="text-muted-foreground">Works with the tools you already use</p>
        <div className="flex flex-wrap justify-center gap-6">
          {TOOLS.map(({ label, icon: Icon }) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <span className="flex size-16 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-sm">
                <Icon className="size-[22px]" />
              </span>
              <span className="text-body-s text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="relative mx-auto flex max-w-[1040px] scroll-mt-6 flex-col gap-8 px-6 pt-16 pb-24">
        <h2 className="text-center font-display text-[32px] leading-9 font-semibold tracking-[-0.02em] md:text-[40px] md:leading-[44px]">
          From idea to working agent in three steps
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="flex flex-col gap-3 rounded-lg border bg-card p-6 shadow-sm">
              <span className="font-display text-[32px] leading-9 font-bold text-brand">{index + 1}</span>
              <h3 className="text-h3 font-semibold">{step.title}</h3>
              <p className="text-muted-foreground">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative mx-auto flex max-w-[1040px] flex-wrap justify-between gap-3 border-t p-6">
        <span className="text-body-s text-muted-foreground">© 2026 Omnix</span>
        <div className="flex gap-5 text-body-s">
          {["Docs", "Privacy", "Terms"].map((label) => (
            <a key={label} href="#how" className="text-muted-foreground no-underline hover:text-foreground">
              {label}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
