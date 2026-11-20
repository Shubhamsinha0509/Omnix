import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, Mail, MessageSquare, NotebookText, SquareKanban } from "lucide-react";

import { agentAvatarUrl } from "@/components/custom/workspace/AgentAvatar";

/** Where "Launch App" goes: the workspace, which sends signed-out visitors to sign in. */
const APP_HREF = "/workspace";

const NAV = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Integrations", href: "#integrations" },
  { label: "Docs", href: "#docs" },
];

/** The apps agents connect to (docs/05-integrations.md). Generic icons, not brand marks. */
const INTEGRATIONS = [
  { name: "Gmail", icon: Mail },
  { name: "Slack", icon: MessageSquare },
  { name: "Notion", icon: NotebookText },
  { name: "Jira", icon: SquareKanban },
  { name: "Calendar", icon: CalendarDays },
];

/** The indigo pill button from the theme: soft glow underneath, light edge on top. */
function LaunchButton({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <Link
      href={APP_HREF}
      className={[
        "inline-flex items-center justify-center rounded-xl font-medium text-white",
        "bg-gradient-to-b from-[#8b8cf9] to-[#6366f1]",
        "shadow-[0_10px_24px_-6px_rgba(99,102,241,0.65),inset_0_1px_0_rgba(255,255,255,0.35)]",
        "transition hover:brightness-105 hover:shadow-[0_14px_30px_-6px_rgba(99,102,241,0.75),inset_0_1px_0_rgba(255,255,255,0.35)]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300/60",
        size === "sm" ? "h-9 px-4 text-sm" : "h-11 px-7 text-[15px]",
      ].join(" ")}
    >
      Launch App
    </Link>
  );
}

/** A soft glass bubble floating in the sky. */
function Bubble({ className, delay = "0s" }: { className: string; delay?: string }) {
  return (
    <div
      aria-hidden
      className={`omnix-motion absolute rounded-full ${className}`}
      style={{
        background:
          "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 38%, rgba(196,190,255,0.35) 70%, rgba(170,180,255,0.15))",
        boxShadow: "inset -6px -10px 24px rgba(150,140,255,0.25), 0 10px 30px rgba(140,150,220,0.15)",
        animation: `omnix-float 9s ease-in-out ${delay} infinite`,
      }}
    />
  );
}

/** A soft cloud made of blurred blobs. */
function Cloud({ className, tone = "white" }: { className: string; tone?: "white" | "peach" }) {
  const color = tone === "peach" ? "bg-[#fbc7ae]" : "bg-white";
  return (
    <div aria-hidden className={`omnix-motion pointer-events-none absolute ${className}`} style={{ animation: "omnix-drift 22s ease-in-out infinite" }}>
      <div className={`absolute left-0 top-6 h-24 w-48 rounded-full ${color} opacity-80 blur-2xl`} />
      <div className={`absolute left-16 top-0 h-32 w-40 rounded-full ${color} opacity-90 blur-2xl`} />
      <div className={`absolute left-32 top-8 h-24 w-44 rounded-full ${color} opacity-80 blur-2xl`} />
    </div>
  );
}

/** One of the user's agents, floating on the hills (the DiceBear clay style used in the app). */
function FloatingAgent({ seed, className, tilt, delay }: { seed: string; className: string; tilt: string; delay: string }) {
  return (
    <div
      aria-hidden
      className={`omnix-motion absolute ${className}`}
      style={{ "--tilt": tilt, animation: `omnix-float 6s ease-in-out ${delay} infinite` } as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- DiceBear serves SVG */}
      <img
        // Transparent background: in the app avatars sit in circles, here they float freely.
        // DiceBear 10 only accepts hex here, so "transparent" is 8-digit hex with zero alpha.
        src={`${agentAvatarUrl(seed)}&backgroundColor=00000000`}
        alt=""
        draggable={false}
        className="size-full drop-shadow-[0_24px_30px_rgba(99,102,241,0.25)]"
      />
      {/* soft shadow on the snow */}
      <div className="mx-auto -mt-2 h-4 w-2/3 rounded-full bg-indigo-900/10 blur-md" />
    </div>
  );
}

/** Rolling snow hills around a pale lake, drawn in SVG so it scales to any width. */
function Landscape() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 560"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-x-0 bottom-0 h-[58%] w-full"
    >
      <defs>
        <linearGradient id="hill-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f6fb" />
          <stop offset="100%" stopColor="#dfe4f1" />
        </linearGradient>
        <linearGradient id="hill-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e9ecf4" />
        </linearGradient>
        <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe0f2" />
          <stop offset="100%" stopColor="#e6f3fa" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7f8fb" stopOpacity="0" />
          <stop offset="60%" stopColor="#f5f6f9" />
          <stop offset="100%" stopColor="#f5f6f9" />
        </linearGradient>
      </defs>

      {/* far hills */}
      <path d="M0 210 C 160 90, 330 80, 470 190 C 560 120, 700 70, 860 150 C 980 70, 1180 60, 1300 170 C 1360 140, 1410 140, 1440 160 L1440 560 L0 560 Z" fill="url(#hill-far)" />
      {/* lake */}
      <path d="M430 330 C 560 300, 880 300, 1010 330 C 1060 350, 1000 410, 860 420 C 700 430, 560 425, 460 400 C 390 380, 380 345, 430 330 Z" fill="url(#lake)" opacity="0.9" />
      {/* near hills, left and right, framing the lake */}
      <path d="M0 260 C 140 180, 300 200, 420 300 C 470 345, 500 400, 470 460 L 0 560 Z" fill="url(#hill-near)" />
      <path d="M1440 250 C 1300 170, 1140 190, 1030 290 C 970 345, 950 410, 990 470 L 1440 560 Z" fill="url(#hill-near)" />
      {/* foreground snow fading into the page */}
      <path d="M0 440 C 300 400, 520 470, 720 450 C 940 430, 1160 400, 1440 430 L1440 560 L0 560 Z" fill="#fbfbfd" />
      <rect x="0" y="380" width="1440" height="180" fill="url(#ground)" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="min-h-svh bg-[#f5f6f9] text-[#1e1b4b]">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative isolate min-h-[100svh] overflow-hidden bg-gradient-to-b from-[#d3ddef] via-[#e6ecf6] to-[#f5f6f9]">
        {/* sky */}
        <Cloud className="left-[4%] top-[14%] h-40 w-72" />
        <Cloud className="right-[6%] top-[8%] h-40 w-72" />
        <Cloud className="left-[38%] top-[2%] h-32 w-72 opacity-70" />
        <Bubble className="left-[10%] top-[44%] hidden size-24 sm:block" delay="0s" />
        <Bubble className="right-[12%] top-[38%] size-7" delay="1.5s" />
        <Bubble className="left-[54%] top-[58%] size-12" delay="3s" />
        <Bubble className="right-[22%] top-[22%] size-4" delay="2s" />

        {/* ground: hills, with peach mist drifting in front of their edges */}
        <Landscape />
        {/* On phones the mist would fill the whole width, so it only appears from `sm` up. */}
        <Cloud className="-left-16 bottom-[20%] hidden h-40 w-72 opacity-70 sm:block" tone="peach" />
        <Cloud className="-right-10 bottom-[24%] hidden h-40 w-72 opacity-70 sm:block" tone="peach" />

        {/* agents */}
        <FloatingAgent seed="omnix-scout" className="left-[4%] bottom-[20%] size-24 sm:left-[14%] sm:bottom-[16%] sm:size-48 lg:size-56" tilt="-8deg" delay="0s" />
        <FloatingAgent seed="omnix-courier" className="right-[4%] bottom-[18%] size-20 sm:right-[12%] sm:bottom-[12%] sm:size-44 lg:size-52" tilt="10deg" delay="1.2s" />

        {/* nav */}
        <header className="absolute inset-x-0 top-5 z-20 px-4">
          <nav className="mx-auto flex max-w-5xl items-center justify-between rounded-2xl border border-white/80 bg-white/55 px-4 py-3 shadow-[0_8px_30px_rgba(120,130,190,0.15)] backdrop-blur-xl">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/logo.png" alt="" width={30} height={30} className="size-[30px]" loading="eager" />
              <span className="text-lg font-semibold tracking-tight">Omnix</span>
            </Link>
            <ul className="hidden items-center gap-8 text-sm text-[#3b3a63] md:flex">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="transition hover:text-[#6366f1]">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
            <LaunchButton size="sm" />
          </nav>
        </header>

        {/* headline */}
        <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 pt-32 text-center sm:pt-44">
          {/* Two lines on wider screens, like the reference; free wrapping on phones. */}
          <h1 className="text-[clamp(2.25rem,5.4vw,4.4rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-balance text-[#1e1b4b]">
            <span className="md:block md:whitespace-nowrap">Create, Connect &amp; Automate</span>{" "}
            <span className="md:block md:whitespace-nowrap">AI Agents Instantly</span>
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[#4a4870] sm:text-base">
            Build personal AI agents, connect them to Gmail, Slack, Notion and Jira, and let them
            work for you — on demand, on a schedule, or on their own virtual machine.
          </p>
          <div className="mt-9">
            <LaunchButton />
          </div>
        </div>
      </section>

      {/* ── Integrations strip ───────────────────────────────── */}
      <section id="integrations" className="relative -mt-24 pb-24 text-center">
        <p className="text-sm text-[#4a4870]">Works with the tools you already use</p>
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-4 px-4">
          {INTEGRATIONS.map(({ name, icon: Icon }) => (
            <li key={name}>
              <div
                title={name}
                className="flex size-16 items-center justify-center rounded-2xl border border-white bg-white/80 text-[#8a8aa3] shadow-[0_6px_20px_rgba(120,130,190,0.12)] transition hover:-translate-y-0.5 hover:text-[#6366f1]"
              >
                <Icon className="size-7" strokeWidth={1.75} />
                <span className="sr-only">{name}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
