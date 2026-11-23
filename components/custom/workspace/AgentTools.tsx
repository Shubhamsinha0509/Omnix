"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ToolPermissionRow } from "@/components/custom/design/ToolPermissionRow";
import { updateAgentTool } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { ToolSetting } from "@/lib/tools";

/**
 * Past this many tools in one group, the group gets a search box.
 *
 * Built-in tools are a handful. An MCP server's are not: Notion publishes about sixty,
 * Atlassian more, and a list that long is not something anyone scrolls looking for one
 * switch (lib/mcp/tools.ts).
 */
const SEARCHABLE_FROM = 12;

type Props = {
  agentId: string;
  agentName: string;
  tools: ToolSetting[];
  /** The user's connected accounts, for the per-tool account picker. */
  connections: SafeConnection[];
};

/**
 * Per-agent tool settings (08-chat-config-tools): which tools this agent may use, with
 * which account, and whether it has to ask first.
 *
 * Each control saves on change rather than waiting for a Save button — these are
 * independent switches, and a half-saved form of them would be worse than none.
 */
export default function AgentTools({ agentId, agentName, tools, connections }: Props) {
  const [state, setState] = useState(tools);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [, startSaving] = useTransition();

  /**
   * One group per place tools come from, in the order the tools arrive — built-in first,
   * then each connected account. Built from the tools themselves rather than a fixed
   * list, because which MCP servers a user has connected is not something this component
   * can know in advance.
   */
  const groups = useMemo(() => {
    const seen = new Map<string, { provider: string | null; title: string; note?: string }>();
    for (const tool of state) {
      const id = tool.provider ?? "";
      if (seen.has(id)) continue;
      seen.set(id, {
        provider: tool.provider,
        title: tool.providerName ?? "Built in",
        note: tool.provider ? undefined : "No account needed",
      });
    }
    return [...seen.values()];
  }, [state]);

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
    <div className="flex flex-col gap-4">
      <p className="text-body-s text-muted-foreground">
        Choose what {agentName} can use. Tools that change your data start off, and {agentName} still
        asks before each one runs.
      </p>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}

      {groups.map((group) => {
        const groupTools = state.filter((tool) => tool.provider === group.provider);
        if (groupTools.length === 0) return null;

        const groupId = group.provider ?? "builtin";
        const needle = (filters[groupId] ?? "").trim().toLowerCase();
        const shown = needle
          ? groupTools.filter((tool) =>
              `${tool.label} ${tool.key} ${tool.summary}`.toLowerCase().includes(needle),
            )
          : groupTools;

        const accounts = connections.filter(
          (connection) => connection.provider === group.provider && connection.status === "active",
        );
        const needsAccount = group.provider !== null && accounts.length === 0;

        return (
          <section key={group.title} className="flex flex-col gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="font-semibold">{group.title}</h3>
              {group.note && (
                <span className="text-caption font-medium text-muted-foreground">{group.note}</span>
              )}
              {group.provider !== null &&
                (accounts.length > 0 ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-caption font-medium text-muted-foreground">
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
                    <span className="truncate">Connected as {accounts[0].accountLabel}</span>
                  </span>
                ) : (
                  <span className="text-caption font-medium text-muted-foreground">
                    Not connected ·{" "}
                    <Link href="/workspace/integrations" className="text-brand-text hover:underline">
                      Connect
                    </Link>
                  </span>
                ))}
            </div>

            {groupTools.length > SEARCHABLE_FROM && (
              <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:border-ring">
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={filters[groupId] ?? ""}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, [groupId]: event.target.value }))
                  }
                  placeholder={`Search ${groupTools.length} ${group.title} tools`}
                  aria-label={`Search ${group.title} tools`}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus-visible:shadow-none!"
                />
              </label>
            )}

            <div className="divide-y rounded-lg border bg-card">
              {shown.map((tool) => (
                <ToolPermissionRow
                  key={tool.key}
                  id={tool.key}
                  label={tool.label}
                  description={tool.summary}
                  writes={tool.risk !== "read"}
                  checked={tool.enabled}
                  disabled={needsAccount}
                  onCheckedChange={(checked) => save(tool.key, { enabled: checked })}
                >
                  {tool.enabled && (accounts.length > 1 || tool.approvalEditable) && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 pl-[30px]">
                      {accounts.length > 1 && (
                        <label className="flex items-center gap-2 text-body-s">
                          <span className="text-muted-foreground">Account</span>
                          <NativeSelect
                            size="sm"
                            value={tool.connectionId ?? ""}
                            onChange={(event) => save(tool.key, { connectionId: event.target.value || null })}
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
                        <label className="flex items-center gap-2 text-body-s">
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
                    <p className="mt-2 pl-[30px] text-caption text-warning-text">
                      This agent can do this without asking, including when it is acting on an email
                      somebody else wrote.
                    </p>
                  )}
                </ToolPermissionRow>
              ))}
              {shown.length === 0 && (
                <p className="px-4 py-3 text-body-s text-muted-foreground">
                  No {group.title} tool matches.
                </p>
              )}
            </div>
          </section>
        );
      })}

      <p className="text-caption text-muted-foreground">
        Tools from a connected app are that app&apos;s own, and start switched off.{" "}
        <Link href="/workspace/integrations" className="text-brand-text hover:underline">
          Connect another app
        </Link>
      </p>
    </div>
  );
}
