"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Clock, Globe, Mail, Plug, Search, ShieldCheck, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { updateAgentTool } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { ToolSetting } from "@/lib/tools";

const TOOL_ICONS: Record<string, typeof Wrench> = {
  "web.search": Search,
  "web.fetch": Globe,
  "time.now": Clock,
  "gmail.search": Mail,
  "gmail.read": Mail,
  "gmail.create_draft": Mail,
  "gmail.send": Mail,
};

/** Tools are grouped by where they come from, which is how people think about them. */
const GROUPS: { provider: string | null; title: string; note?: string }[] = [
  { provider: null, title: "Built in", note: "No account needed." },
  { provider: "gmail", title: "Gmail" },
];

type Props = {
  agentId: string;
  tools: ToolSetting[];
  /** The user's connected accounts, for the per-tool account picker. */
  connections: SafeConnection[];
};

/**
 * Per-agent tool settings: which tools this agent may use, with which account, and
 * whether it has to ask first.
 *
 * Each control saves on change rather than waiting for a Save button — these are
 * independent switches, and a half-saved form of them would be worse than none.
 */
export default function AgentTools({ agentId, tools, connections }: Props) {
  const [state, setState] = useState(tools);
  const [error, setError] = useState<string | null>(null);
  const [, startSaving] = useTransition();

  const save = (key: string, change: Partial<ToolSetting>) => {
    const before = state;
    const next = state.map((tool) => (tool.key === key ? { ...tool, ...change } : tool));
    setState(next);
    setError(null);

    const updated = next.find((tool) => tool.key === key);
    if (!updated) return;

    startSaving(async () => {
      const result = await updateAgentTool(agentId, {
        tool: key,
        enabled: updated.enabled,
        connectionId: updated.connectionId,
        approval: updated.approval,
      });
      // Put the switch back where it was rather than leave the UI claiming something
      // the database doesn't say.
      if (result?.error) {
        setState(before);
        setError(result.error);
      }
    });
  };

  return (
    <section>
      <h2 className="font-semibold">Tools</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What this agent is allowed to do. Everything is off until you turn it on, and anything
        that writes or sends asks you first unless you say otherwise.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {GROUPS.map((group) => {
        const groupTools = state.filter((tool) => tool.provider === group.provider);
        if (groupTools.length === 0) return null;

        const accounts = connections.filter(
          (connection) => connection.provider === group.provider && connection.status === "active",
        );
        const needsAccount = group.provider !== null && accounts.length === 0;

        return (
          <div key={group.title} className="mt-6">
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-medium tracking-wider text-muted-foreground uppercase">
                {group.title}
              </h3>
              {group.note && <span className="text-xs text-muted-foreground">{group.note}</span>}
            </div>

            {needsAccount && (
              <p className="mb-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                <Plug className="size-4 shrink-0" />
                <span>
                  No {group.title} account connected.{" "}
                  <Link href="/workspace/connections" className="underline underline-offset-4">
                    Connect one
                  </Link>{" "}
                  to use these.
                </span>
              </p>
            )}

            <ul className="divide-y rounded-xl border">
              {groupTools.map((tool) => {
                const Icon = TOOL_ICONS[tool.key] ?? Wrench;
                return (
                  <li key={tool.key} className="px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{tool.label}</span>
                          <code className="text-xs text-muted-foreground">{tool.key}</code>
                          {tool.risk !== "read" && (
                            <Badge variant={tool.risk === "destructive" ? "destructive" : "outline"}>
                              {tool.risk === "destructive" ? "Destructive" : "Writes"}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">{tool.summary}</p>
                      </div>
                      <Switch
                        checked={tool.enabled}
                        disabled={needsAccount}
                        onCheckedChange={(checked) => save(tool.key, { enabled: Boolean(checked) })}
                        aria-label={`Allow ${tool.label}`}
                      />
                    </div>

                    {tool.enabled && (accounts.length > 1 || tool.approvalEditable) && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 pl-7">
                        {accounts.length > 1 && (
                          <label className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Account</span>
                            <NativeSelect
                              size="sm"
                              value={tool.connectionId ?? ""}
                              onChange={(event) =>
                                save(tool.key, { connectionId: event.target.value || null })
                              }
                            >
                              <NativeSelectOption value="">Any connected account</NativeSelectOption>
                              {accounts.map((account) => (
                                <NativeSelectOption key={account.id} value={account.id}>
                                  {account.accountLabel}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                          </label>
                        )}

                        {tool.approvalEditable && (
                          <label className="flex items-center gap-2 text-sm">
                            <Switch
                              size="sm"
                              checked={tool.approval === "always"}
                              onCheckedChange={(checked) =>
                                save(tool.key, { approval: checked ? "always" : "never" })
                              }
                            />
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <ShieldCheck className="size-3.5" />
                              Ask me before this runs
                            </span>
                          </label>
                        )}
                      </div>
                    )}

                    {tool.enabled && tool.approvalEditable && tool.approval === "never" && (
                      <p className="mt-2 pl-7 text-xs text-amber-700 dark:text-amber-400">
                        This agent can do this without asking — including when it is acting on an
                        email somebody else wrote.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
