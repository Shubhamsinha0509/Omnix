"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquare, ShieldCheck } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ToolPermissionRow } from "@/components/custom/design/ToolPermissionRow";
import { updateAgentTool } from "@/app/workspace/actions";
import type { SafeConnection } from "@/lib/integrations/connections";
import type { ToolSetting } from "@/lib/tools";

/** Tools are grouped by where they come from, which is how people think about them. */
const GROUPS: { provider: string | null; title: string; note?: string }[] = [
  { provider: null, title: "Built in", note: "No account needed" },
  { provider: "gmail", title: "Gmail" },
];

/** Apps with no tools yet, shown as a connect row (the Slack row in 08). */
const COMING = [{ key: "slack", title: "Slack" }];

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

      {GROUPS.map((group) => {
        const groupTools = state.filter((tool) => tool.provider === group.provider);
        if (groupTools.length === 0) return null;

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

            <div className="divide-y rounded-lg border bg-card">
              {groupTools.map((tool) => (
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
            </div>
          </section>
        );
      })}

      {COMING.map((app) => (
        <div key={app.key} className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3">
          <MessageSquare className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">{app.title}</span>
            <span className="text-caption font-medium text-muted-foreground">Not connected</span>
          </span>
          <Link href="/workspace/integrations" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Connect
          </Link>
        </div>
      ))}
    </div>
  );
}
