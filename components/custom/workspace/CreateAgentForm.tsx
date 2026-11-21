"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Code,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Plug,
  SlidersVertical,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { createAgent, type CreateCapabilities } from "@/app/workspace/actions";
import { cn } from "@/lib/utils";
import { AgentFields, type AgentDraft } from "./AgentFields";

type Capability = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Which switch it sets; capabilities without one aren't built yet. */
  maps?: keyof CreateCapabilities;
};

const CAPABILITIES: Capability[] = [
  { key: "web", label: "Web search", icon: Globe, maps: "webSearch" },
  // TODO(backend): file analysis, code execution (Phase 6 VMs), images and custom tools.
  { key: "files", label: "File analysis", icon: FileText },
  { key: "code", label: "Code execution", icon: Code },
  { key: "tools", label: "Tool use", icon: Wrench, maps: "toolUse" },
  { key: "multimodal", label: "Multi-modal", icon: ImageIcon },
  { key: "custom", label: "Custom tools", icon: Plug },
];

/** One capability (`label.capbox`): a 48px tile with a checkbox, indigo when on. */
function CapabilityBox({
  capability,
  checked,
  onChange,
  disabled,
}: {
  capability: Capability;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const Icon = capability.icon;
  const available = Boolean(capability.maps);
  return (
    <label
      title={available ? undefined : "Coming soon"}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-md border border-input bg-card p-3 font-medium",
        available ? "cursor-pointer" : "cursor-not-allowed opacity-60",
        checked && "border-brand bg-accent",
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled || !available}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-[6px] border-[1.5px] border-input bg-card text-white peer-focus-visible:shadow-[var(--focus-ring)]",
          checked && "border-brand-fill bg-brand-fill",
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="flex-1">
        {capability.label}
        {!available && <span className="sr-only"> (coming soon)</span>}
      </span>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </label>
  );
}

/** The Create agent form card and its actions (11-create-agent). */
export function CreateAgentForm({
  initialSeed,
  model,
  limits,
}: {
  initialSeed: string;
  model: { id: string; label: string };
  limits: { steps: number; toolCalls: number };
}) {
  const [draft, setDraft] = useState<AgentDraft>({ name: "", instructions: "", avatarSeed: initialSeed });
  const [capabilities, setCapabilities] = useState<CreateCapabilities>({ webSearch: true, toolUse: true });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      // On success the server redirects to the "your agent is ready" screen.
      const result = await createAgent(draft, capabilities);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <>
      <form
        id="create-agent"
        onSubmit={submit}
        className="flex flex-col gap-6 rounded-xl border bg-card p-8 shadow-md"
      >
        <AgentFields layout="side" draft={draft} onChange={setDraft} disabled={isPending} />

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 p-0 text-h3 font-semibold">Capabilities</legend>
          <p className="text-body-s text-muted-foreground">
            Pick what this agent can do. You can change these later in Tools.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {CAPABILITIES.map((capability) => (
              <CapabilityBox
                key={capability.key}
                capability={capability}
                disabled={isPending}
                checked={capability.maps ? capabilities[capability.maps] : false}
                onChange={(checked) =>
                  capability.maps &&
                  setCapabilities((current) => ({ ...current, [capability.maps!]: checked }))
                }
              />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((open) => !open)}
            className="flex cursor-pointer items-center gap-3 rounded-md bg-muted px-4 py-3 text-left text-foreground"
          >
            <SlidersVertical className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-1 flex-col">
              <span className="font-medium">Advanced settings</span>
              <span className="text-body-s text-muted-foreground">Model, response length, run limits</span>
            </span>
            <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
          </button>
          {advanced && (
            <dl className="grid gap-3 rounded-md border px-4 py-3 text-body-s sm:grid-cols-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption font-medium text-muted-foreground">Model</dt>
                <dd title={model.id}>{model.label} · set for the workspace</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption font-medium text-muted-foreground">Response length</dt>
                <dd>Up to the model</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption font-medium text-muted-foreground">Run limits</dt>
                <dd>
                  {limits.steps} steps, {limits.toolCalls} tool calls per run
                </dd>
              </div>
            </dl>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
            {error}
          </p>
        )}
      </form>

      <div className="flex justify-end gap-3">
        <Link href="/workspace/agents" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
        <Button type="submit" form="create-agent" disabled={!draft.name.trim() || isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          {isPending ? "Creating…" : "Create agent"}
        </Button>
      </div>
    </>
  );
}
