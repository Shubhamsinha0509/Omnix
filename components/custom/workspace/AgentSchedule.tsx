"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Check, Clock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { saveTask } from "@/app/workspace/agent/[id]/tasks/actions";
import { TASK_LIMITS } from "@/lib/agent-limits";
import { nextOccurrence } from "@/lib/schedule/cron";
import type { TaskView } from "@/lib/tasks";
import { fromCron, toCron } from "./AgentTasks";

type Repeat = "once" | "daily" | "weekdays" | "weekly" | "custom";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Every IANA zone the browser knows, with the current one guaranteed to be in the list. */
function timezones(current: string) {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

/** "Mon, Nov 23 · 9:00 AM" in the schedule's own timezone. */
function formatRun(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("month")} ${get("day")} · ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

/**
 * The drawer's Schedule tab (09-chat-config-schedule): one schedule for this agent — when
 * it runs, in which timezone, and what it does each time — with the next three runs shown
 * as you change it.
 *
 * Underneath it is the agent's first scheduled task (or a new one); an agent with several
 * tasks gets a link to all of them on the Tasks page.
 */
export function AgentSchedule({
  agentId,
  agentName,
  tasks,
}: {
  agentId: string;
  agentName: string;
  tasks: TaskView[];
}) {
  const task = tasks.find((candidate) => candidate.trigger === "schedule") ?? null;
  const read = fromCron(task?.schedule ?? "0 9 * * 1-5");

  const [enabled, setEnabled] = useState(task ? task.enabled : true);
  const [repeat, setRepeat] = useState<Repeat>(
    read.preset === "hourly" || read.preset === "quarter" ? "custom" : read.preset,
  );
  const [time, setTime] = useState(read.time);
  const [weekday, setWeekday] = useState(read.weekday);
  const [custom, setCustom] = useState(task?.schedule ?? "0 9 * * 1-5");
  const [timezone, setTimezone] = useState(
    task?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const schedule = repeat === "custom" ? custom.trim() : toCron(repeat === "once" ? "daily" : repeat, time, weekday);
  const zones = useMemo(() => timezones(timezone), [timezone]);

  const upcoming = useMemo(() => {
    const runs: Date[] = [];
    let after = new Date();
    for (let i = 0; i < 3; i++) {
      const next = nextOccurrence(schedule, timezone, after);
      if (!next) break;
      runs.push(next);
      after = new Date(next.getTime() + 60_000);
    }
    return runs;
  }, [schedule, timezone]);

  const save = () => {
    setError(null);
    setSaved(false);
    startSaving(async () => {
      const result = await saveTask(agentId, task?.id ?? null, {
        name: task?.name ?? `${agentName} schedule`,
        prompt,
        trigger: "schedule",
        schedule,
        timezone,
        deliver: task?.deliver ?? ["inapp"],
        enabled,
      });
      if ("error" in result) setError(result.error);
      else {
        setSaved(true);
        toast.add({ title: "Schedule saved", type: "success" });
      }
    });
  };

  const field = "flex flex-col gap-1.5";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <CalendarClock className="size-[18px] shrink-0 text-brand" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">Run on a schedule</span>
          <span className="text-caption font-medium text-muted-foreground">
            {agentName} runs by itself and reports to your Inbox.
          </span>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => {
            setEnabled(Boolean(checked));
            setSaved(false);
          }}
          aria-label="Run on a schedule"
        />
      </div>

      <div className={field}>
        <span className="font-medium" id="repeat-label">
          Repeat
        </span>
        <Tabs value={repeat} onValueChange={(value) => { setRepeat(value as Repeat); setSaved(false); }}>
          <TabsList aria-labelledby="repeat-label" className="w-full text-body-s">
            {/* TODO(backend): one-off runs need a task that switches itself off after firing. */}
            <TabsTrigger value="once" disabled title="One-off runs are coming soon">
              Once
            </TabsTrigger>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="weekdays">Weekdays</TabsTrigger>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {repeat === "weekly" && (
        <label className={field}>
          <span className="font-medium">Day</span>
          <NativeSelect value={String(weekday)} onChange={(event) => setWeekday(Number(event.target.value))}>
            {WEEKDAYS.map((day, index) => (
              <NativeSelectOption key={day} value={String(index)}>
                {day}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}

      {repeat === "custom" ? (
        <label className={field}>
          <span className="font-medium">Cron expression</span>
          <Input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="0 9 * * 1-5"
            className="font-mono"
          />
        </label>
      ) : null}

      <div className="flex items-start gap-3">
        {repeat !== "custom" && (
          <label className={`${field} min-w-0 flex-1`}>
            <span className="font-medium">Time</span>
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value || "09:00")}
            />
          </label>
        )}
        <label className={`${field} min-w-0 flex-1`}>
          <span className="font-medium">Timezone</span>
          <NativeSelect value={timezone} onChange={(event) => setTimezone(event.target.value)} className="w-full">
            {zones.map((zone) => (
              <NativeSelectOption key={zone} value={zone}>
                {zone}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>

      <label className={field}>
        <span className="font-medium">Each run</span>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={TASK_LIMITS.maxPrompt}
          placeholder="Summarize unread email from the last 24 hours, group duplicates, and post it to my Inbox."
          className="min-h-[88px] resize-none"
        />
      </label>

      <div className="flex flex-col gap-2 rounded-lg bg-muted px-4 py-3">
        <span className="text-caption font-medium text-muted-foreground">Next runs</span>
        {upcoming.length > 0 ? (
          upcoming.map((run) => (
            <span key={run.toISOString()} className="flex items-center gap-2 text-body-s">
              <Clock className="size-3.5 shrink-0" />
              {formatRun(run, timezone)}
            </span>
          ))
        ) : (
          <span className="text-body-s text-warning-text">
            That schedule never comes round. Check the expression and the timezone.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
          {error}
        </p>
      )}

      <Button
        className="w-full"
        onClick={save}
        disabled={isSaving || !prompt.trim() || upcoming.length === 0 || (!task && !enabled)}
      >
        {isSaving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
        {isSaving ? "Saving…" : saved ? "Saved" : "Save schedule"}
      </Button>

      {tasks.length > 1 && (
        <Link
          href={`/workspace/agent/${agentId}/tasks`}
          className="text-center text-body-s font-medium text-brand-text hover:underline"
        >
          {agentName} has {tasks.length} tasks · manage them all
        </Link>
      )}
    </div>
  );
}
