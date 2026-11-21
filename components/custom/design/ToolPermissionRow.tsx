"use client";

import { Clock, Globe, Mail, Search, SquarePen, Wrench, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

/** Each tool's icon, as the tools tab draws it. */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  "time.now": Clock,
  "web.search": Search,
  "web.fetch": Globe,
  "gmail.search": Mail,
  "gmail.read": Mail,
  "gmail.create_draft": SquarePen,
  "gmail.send": SquarePen,
};

/**
 * One tool an agent may use (`.tool` in 08-chat-config-tools): icon, plain-language name,
 * its id in mono, what it does, and a switch. A tool that changes your data carries the
 * amber "Writes" badge; those start off and still ask before each run.
 */
export function ToolPermissionRow({
  id,
  label,
  description,
  writes,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  id: string;
  label: string;
  description: string;
  writes: boolean;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Extra controls shown under the row (account picker, ask-first switch). */
  children?: React.ReactNode;
}) {
  const Icon = TOOL_ICONS[id] ?? Wrench;
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{label}</span>
            <code className="rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
              {id}
            </code>
            {writes && (
              <Badge variant="warn">
                <SquarePen />
                Writes
              </Badge>
            )}
          </div>
          <span className="text-body-s text-muted-foreground">{description}</span>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(Boolean(value))}
          aria-label={label}
        />
      </div>
      {children}
    </div>
  );
}
