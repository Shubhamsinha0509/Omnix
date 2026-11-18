"use client";

import { Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_AGENT_INSTRUCTIONS, MAX_AGENT_NAME } from "@/lib/agent-limits";
import { AgentAvatar, randomAvatarSeed } from "./AgentAvatar";

export type AgentDraft = {
  name: string;
  instructions: string;
  avatarSeed: string;
};

/**
 * Avatar, name and instructions — the fields every agent has. Shared by
 * "Create New Agent" and agent settings so both always offer the same options.
 */
export function AgentFields({
  draft,
  onChange,
  disabled = false,
}: {
  draft: AgentDraft;
  onChange: (draft: AgentDraft) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      {/* Avatar preview */}
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-full bg-muted p-2">
          <div className="size-28 rounded-full bg-muted">
            {draft.avatarSeed && (
              <AgentAvatar key={draft.avatarSeed} seed={draft.avatarSeed} name={draft.name || "Agent"} />
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => set("avatarSeed", randomAvatarSeed())}
          disabled={disabled || !draft.avatarSeed}
        >
          <Shuffle />
          Shuffle avatar
        </Button>
      </div>

      {/* Name */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-name">Agent name</Label>
        <Input
          id="agent-name"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Enter agent name"
          maxLength={MAX_AGENT_NAME}
          required
          disabled={disabled}
          className="h-10"
        />
      </div>

      {/* Instructions */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-instructions">
          Instructions / Description
          <span className="text-xs font-normal text-muted-foreground">Optional</span>
        </Label>
        <Textarea
          id="agent-instructions"
          value={draft.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="Describe what this agent should do, its personality, goals, or special instructions..."
          maxLength={MAX_AGENT_INSTRUCTIONS}
          rows={5}
          disabled={disabled}
          className="min-h-28 resize-none"
        />
        <p className="text-right text-xs text-muted-foreground">
          {draft.instructions.length} / {MAX_AGENT_INSTRUCTIONS}
        </p>
      </div>
    </>
  );
}
