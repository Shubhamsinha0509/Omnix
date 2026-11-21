"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  Cpu,
  History,
  Loader2,
  Lock,
  Plug,
  Settings,
  ShieldCheck,
  SlidersVertical,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModelChip } from "@/components/custom/design/Chips";
import { updateAgent, updateAgentTool } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import { MOCK_AGENT_SETTINGS } from "@/lib/mock-data";
import type { TaskView } from "@/lib/tasks";
import type { ToolSetting } from "@/lib/tools";
import { AgentSchedule } from "./AgentSchedule";
import AgentTools from "./AgentTools";
import { AgentFields, type AgentDraft } from "./AgentFields";
import { DeleteAgent } from "./DeleteAgent";

export type AgentConfig = {
  /** Every tool there is, with this agent's current choice for each. */
  tools: ToolSetting[];
  /** The user's connected accounts, so a tool can be pointed at one. */
  connections: SafeConnection[];
  /** How many conversations go with the agent if it is deleted. */
  conversationCount: number;
  /** What this agent does on its own, for the Schedule tab. */
  tasks: TaskView[];
  /** The model every agent runs on (lib/ai.ts), shown in Settings. */
  model: { id: string; label: string };
};

export type ConfigTab = "instructions" | "tools" | "schedule" | "settings";

type Props = AgentConfig & {
  agent: { id: string; name: string; instructions: string; avatarSeed: string };
  tab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
  onClose: () => void;
};

const TABS = [
  { value: "instructions", label: "Instructions", icon: SlidersVertical },
  { value: "tools", label: "Tools", icon: Plug },
  { value: "schedule", label: "Schedule", icon: CalendarClock },
  { value: "settings", label: "Settings", icon: Settings },
] as const;

/** One row of the Settings tab list (`.lrow`): icon, name and note, control. */
function SettingRow({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
      <Icon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-body-s text-muted-foreground">{note}</span>
      </span>
      {children}
    </div>
  );
}

/**
 * "Ask before writing": one switch over every write tool whose approval can be changed.
 * On means each of them asks first (the default); a tool that always asks stays asking.
 */
function AskBeforeWriting({ agentId, tools }: { agentId: string; tools: ToolSetting[] }) {
  const writes = tools.filter((tool) => tool.risk !== "read" && tool.approvalEditable);
  const [on, setOn] = useState(writes.every((tool) => tool.approval === "always"));
  const [busy, startSaving] = useTransition();

  const change = (next: boolean) => {
    const before = on;
    setOn(next);
    startSaving(async () => {
      const results = await Promise.all(
        writes.map((tool) =>
          updateAgentTool(agentId, {
            tool: tool.key,
            enabled: tool.enabled,
            connectionId: tool.connectionId,
            approval: next ? "always" : "never",
          }),
        ),
      );
      if (results.some((result) => result?.error)) setOn(before);
    });
  };

  return (
    <Switch
      checked={writes.length === 0 ? true : on}
      disabled={writes.length === 0 || busy}
      onCheckedChange={(checked) => change(Boolean(checked))}
      aria-label="Ask before writing"
    />
  );
}

/**
 * The configuration drawer beside the chat (07–10-chat-config-*): instructions, tools,
 * schedule and settings, so an agent can be tuned without leaving the conversation.
 */
export default function AgentConfigPanel({
  agent,
  tools,
  connections,
  conversationCount,
  tasks,
  model,
  tab,
  onTabChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<AgentDraft>({
    name: agent.name,
    instructions: agent.instructions,
    avatarSeed: agent.avatarSeed,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const changed =
    draft.name !== agent.name ||
    draft.instructions !== agent.instructions ||
    draft.avatarSeed !== agent.avatarSeed;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startSaving(async () => {
      // `stay`: refresh in place instead of navigating, so the chat stays open.
      const result = await updateAgent(agent.id, draft, { stay: true });
      if (result?.error) setError(result.error);
      else setSaved(true);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-h2 font-semibold">Agent configuration</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close configuration"
          className="[&_svg:not([class*='size-'])]:size-5"
        >
          <X />
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as ConfigTab)}
        className="flex min-h-0 flex-1 flex-col gap-5"
      >
        <TabsList variant="icon">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          <TabsContent value="instructions">
            <form onSubmit={save} className="flex flex-col gap-4">
              <AgentFields
                draft={draft}
                showHint
                disabled={isSaving}
                onChange={(next) => {
                  setDraft(next);
                  setSaved(false);
                }}
              />
              {error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={!draft.name.trim() || !changed || isSaving}>
                {isSaving ? <Loader2 className="animate-spin" /> : saved && !changed ? <Check /> : null}
                {isSaving ? "Saving…" : saved && !changed ? "Saved" : "Save changes"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="tools">
            <AgentTools agentId={agent.id} agentName={agent.name} tools={tools} connections={connections} />
          </TabsContent>

          <TabsContent value="schedule">
            <AgentSchedule agentId={agent.id} agentName={agent.name} tasks={tasks} />
          </TabsContent>

          <TabsContent value="settings" className="flex flex-col gap-4">
            <div className="divide-y rounded-lg border bg-card">
              <SettingRow icon={Cpu} title="Model" note="Set for the whole workspace.">
                <span title={model.id}>
                  <ModelChip label={model.label} dot={false} className="text-body-s" />
                </span>
              </SettingRow>
              <SettingRow icon={Lock} title="Ask before writing" note="Confirm each send, post or edit.">
                <AskBeforeWriting agentId={agent.id} tools={tools} />
              </SettingRow>
              {/* TODO(backend): see MOCK_AGENT_SETTINGS in lib/mock-data.ts. */}
              <SettingRow icon={ShieldCheck} title="Isolated VM" note="Runs code and browsing in a sandbox.">
                <Switch checked={MOCK_AGENT_SETTINGS.isolatedVm} disabled aria-label="Isolated VM (coming soon)" />
              </SettingRow>
              <SettingRow
                icon={History}
                title="Remember past chats"
                note={`Uses earlier chats with ${agent.name} as context.`}
              >
                <Switch
                  checked={MOCK_AGENT_SETTINGS.rememberPastChats}
                  disabled
                  aria-label="Remember past chats (coming soon)"
                />
              </SettingRow>
            </div>
            <DeleteAgent agent={agent} conversationCount={conversationCount} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
