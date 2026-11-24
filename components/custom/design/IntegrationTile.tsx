"use client";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { agentCardClass } from "./AgentCard";
import { cn } from "@/lib/utils";

export type IntegrationTileData = {
  key: string;
  name: string;
  description: string;
  /** Letter mark and brand colour for the 44px tile (`.logo`). */
  mark: string;
  color: string;
  connected: boolean;
  /** Connected: whether agents may use it. */
  enabled?: boolean;
  toolCount?: number;
};

/**
 * An app agents can use (`.acard` in 15-integrations): logo, name, what it does, and
 * either the "available to agents" switch (connected) or a Connect action.
 */
export function IntegrationTile({
  integration,
  action,
  onEnabledChange,
  footer,
}: {
  integration: IntegrationTileData;
  /** Shown top-right when not connected: usually a Connect button or link. */
  action?: React.ReactNode;
  onEnabledChange?: (enabled: boolean) => void;
  /** Replaces the default status line. */
  footer?: React.ReactNode;
}) {
  const { name, description, mark, color, connected, enabled, toolCount } = integration;
  return (
    <article className={cn(agentCardClass, "min-h-0 gap-3.5")}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-md font-bold text-white",
            mark.length > 1 ? "text-base" : "text-lg",
          )}
          style={{ background: color }}
        >
          {mark}
        </span>
        <span className="flex-1" />
        {connected && onEnabledChange ? (
          <Switch
            checked={Boolean(enabled)}
            onCheckedChange={(value) => onEnabledChange(Boolean(value))}
            aria-label={`${name} available to agents`}
          />
        ) : (
          action
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-h3 font-semibold">{name}</h3>
        <p className="text-body-s text-muted-foreground">{description}</p>
      </div>
      {footer ?? (
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <Badge variant="run">Connected</Badge>
              {toolCount !== undefined && (
                <span className="text-caption font-medium text-muted-foreground">
                  {toolCount} {toolCount === 1 ? "tool" : "tools"}
                </span>
              )}
            </>
          ) : (
            <span className="text-caption font-medium text-muted-foreground">Not connected</span>
          )}
        </div>
      )}
    </article>
  );
}
