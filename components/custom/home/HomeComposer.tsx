"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ChevronDown, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { ModelChip, SuggestionChip } from "@/components/custom/design/Chips";
import type { SidebarAgent } from "@/components/custom/shell/AppSidebar";

/**
 * "Ask <agent> anything…" (03-home): pick an agent, write, and the message opens a new chat
 * with that agent and sends there — the chat page picks it up from `?prompt=`. The chips
 * under it are the picked agent's own starters (lib/agent-guide.ts).
 */
export function HomeComposer({
  agents,
  starters,
  model,
}: {
  agents: SidebarAgent[];
  /** Each agent's chat starters, by agent id. */
  starters: Record<string, string[]>;
  model: { id: string; label: string };
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const agent = agents.find((candidate) => candidate.id === agentId) ?? null;

  const send = () => {
    const prompt = text.trim();
    if (!prompt || sending) return;
    if (!agent) {
      router.push("/workspace/create-agent");
      return;
    }
    setSending(true);
    router.push(`/workspace/agent/${agent.id}?new=1&prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-md focus-within:border-ring"
      >
        <label htmlFor="home-prompt" className="sr-only">
          {agent ? `Ask ${agent.name} anything` : "Create an agent to start"}
        </label>
        <textarea
          id="home-prompt"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={agent ? `Ask ${agent.name} anything…` : "Create an agent first, then ask it anything…"}
          className="field-sizing-content max-h-60 min-h-[52px] resize-none bg-transparent p-1 text-body-l text-foreground outline-none placeholder:text-muted-foreground focus-visible:shadow-none!"
        />
        <div className="flex flex-wrap items-center gap-2">
          {agent && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-muted px-3 font-medium whitespace-nowrap text-foreground">
                <span className="size-[22px] shrink-0">
                  <AgentAvatar seed={agent.avatarSeed} name="" />
                </span>
                {agent.name}
                <ChevronDown className="size-3.5 text-muted-foreground" />
                <span className="sr-only">: choose an agent</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuGroup>
                  {agents.map((option) => (
                    <DropdownMenuItem key={option.id} onClick={() => setAgentId(option.id)}>
                      <span className="size-6 shrink-0">
                        <AgentAvatar seed={option.avatarSeed} name="" />
                      </span>
                      {option.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <span title={model.id}>
            <ModelChip label={model.label} />
          </span>
          {/* TODO(backend): attachments — the chat API takes text only for now. */}
          <Button type="button" variant="ghost" size="icon" aria-label="Attach a file" disabled title="Attachments are coming soon">
            <Paperclip />
          </Button>
          <span className="flex-1" />
          <Button type="submit" variant="brand" size="icon" aria-label="Send" disabled={!text.trim() || sending}>
            <ArrowUp className="size-[18px]" />
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        {(agent ? (starters[agent.id] ?? []) : []).map((suggestion) => (
          <SuggestionChip
            key={suggestion}
            onClick={() => {
              setText(suggestion);
              document.getElementById("home-prompt")?.focus();
            }}
          >
            {suggestion}
          </SuggestionChip>
        ))}
      </div>
    </>
  );
}
