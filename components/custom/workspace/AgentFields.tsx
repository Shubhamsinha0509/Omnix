"use client";

import { useId } from "react";
import { Shuffle, Sparkle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextareaWithCounter } from "@/components/ui/textarea";
import { MAX_AGENT_INSTRUCTIONS, MAX_AGENT_NAME } from "@/lib/agent-limits";
import { cn } from "@/lib/utils";
import { AgentAvatar, randomAvatarSeed } from "./AgentAvatar";

export type AgentDraft = {
  name: string;
  instructions: string;
  avatarSeed: string;
};

/** Starting points offered while an agent has no instructions (07-chat-config-instructions). */
export const INSTRUCTION_TEMPLATES = [
  {
    label: "Inbox digest",
    text: "Every morning, summarize my unread email from the last 24 hours. Group messages from the same thread, flag anything that needs a reply, and keep it short.",
  },
  {
    label: "Research brief",
    text: "Find the 5 most important stories on the topic I give you, summarize each in two lines, and link the source.",
  },
  {
    label: "Code helper",
    text: "Help me write, review and debug code. Explain changes briefly, prefer small focused edits, and ask before assuming anything about my setup.",
  },
];

/** The avatar with its Shuffle button under it. */
export function AvatarPicker({
  seed,
  size,
  onShuffle,
  disabled,
}: {
  seed: string;
  size: 88 | 96;
  onShuffle: (seed: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <span className={cn("block rounded-full bg-muted", size === 96 ? "size-24" : "size-22")}>
        {seed && <AgentAvatar key={seed} seed={seed} name="" />}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onShuffle(randomAvatarSeed(seed))}
        disabled={disabled || !seed}
      >
        <Shuffle className="size-3.5" />
        Shuffle avatar
      </Button>
    </div>
  );
}

/** A labelled field (`.field`): 6px between the medium-weight label and the control. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-caption font-medium text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** "savvyy has no instructions yet" with the template buttons (the accent box in 07). */
export function NoInstructionsHint({
  name,
  onTemplate,
  disabled,
}: {
  name: string;
  onTemplate: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-accent p-4">
      <div className="flex items-center gap-2 text-accent-foreground">
        <Sparkle className="size-4 shrink-0" />
        <span className="font-semibold">{name || "This agent"} has no instructions yet</span>
      </div>
      <p className="text-body-s">
        Without them it acts as a general assistant. Write a few lines, or start from a template:
      </p>
      <div className="flex flex-wrap gap-2">
        {INSTRUCTION_TEMPLATES.map((template) => (
          <Button
            key={template.label}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={disabled}
            onClick={() => onTemplate(template.text)}
          >
            {template.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Avatar, name and instructions: the fields every agent has. Shared by Create agent
 * (`side`: avatar beside the fields, 11-create-agent) and the configuration drawer
 * (`stacked`, 07-chat-config-instructions), so both always offer the same options.
 */
export function AgentFields({
  draft,
  onChange,
  disabled = false,
  layout = "stacked",
  showHint = false,
}: {
  draft: AgentDraft;
  onChange: (draft: AgentDraft) => void;
  disabled?: boolean;
  layout?: "stacked" | "side";
  /** Show the no-instructions box with templates while instructions are empty. */
  showHint?: boolean;
}) {
  const id = useId();
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const avatar = (
    <AvatarPicker
      seed={draft.avatarSeed}
      size={layout === "side" ? 96 : 88}
      onShuffle={(seed) => set("avatarSeed", seed)}
      disabled={disabled}
    />
  );

  const name = (
    <Field id={`${id}-name`} label="Agent name">
      <Input
        id={`${id}-name`}
        value={draft.name}
        onChange={(event) => set("name", event.target.value)}
        placeholder="Name your agent"
        maxLength={MAX_AGENT_NAME}
        required
        disabled={disabled}
      />
    </Field>
  );

  const instructions = (
    <Field id={`${id}-instructions`} label="Instructions" hint="Optional">
      <TextareaWithCounter
        id={`${id}-instructions`}
        value={draft.instructions}
        onChange={(event) => set("instructions", event.target.value)}
        placeholder="Tell this agent what to do, how to sound, and what to avoid."
        maxLength={MAX_AGENT_INSTRUCTIONS}
        disabled={disabled}
        className="resize-none"
      />
    </Field>
  );

  if (layout === "side") {
    return (
      <div className="flex flex-col items-stretch gap-6 md:flex-row md:items-start">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {name}
          {instructions}
        </div>
      </div>
    );
  }

  return (
    <>
      {avatar}
      {name}
      {showHint && !draft.instructions.trim() && (
        <NoInstructionsHint
          name={draft.name}
          disabled={disabled}
          onTemplate={(text) => set("instructions", text)}
        />
      )}
      {instructions}
    </>
  );
}
