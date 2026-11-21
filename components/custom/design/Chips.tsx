"use client";

import { ChevronDown, Sparkle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The model in use, as a pill (`.pill` with a green dot): "Auto · balanced". Agents use
 * the model the server is configured with (lib/ai.ts), so this reads rather than picks.
 */
export function ModelChip({
  label,
  className,
  dot = true,
}: {
  label: string;
  className?: string;
  /** The green "available" dot; the Settings tab shows the pill without it. */
  dot?: boolean;
}) {
  return (
    <span
      title="The model this agent uses"
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border border-input bg-card px-3 font-medium whitespace-nowrap text-foreground",
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" />}
      {label}
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

/** A prompt to try (`.chip`): pill with an indigo sparkle. */
export function SuggestionChip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full max-md:min-h-11 max-md:h-auto max-md:py-2 border border-input bg-card px-4 whitespace-nowrap text-foreground shadow-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 max-md:max-w-full max-md:whitespace-normal max-md:text-left"
    >
      <Sparkle className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
      {children}
    </button>
  );
}
