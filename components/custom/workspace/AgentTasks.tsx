"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  CalendarClock,
  Check,
  Inbox,
  Loader2,
  Mail,
  Play,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  removeTask,
  runTaskNow,
  saveTask,
  toggleTask,
  type TaskActionResult,
  type TaskFormInput,
} from "@/app/workspace/agent/[id]/tasks/actions";
import { TASK_LIMITS } from "@/lib/agent-limits";
import { describeSchedule, nextOccurrence } from "@/lib/schedule/cron";
// Type only, so nothing from the task module itself reaches the browser.
import type { TaskView } from "@/lib/tasks";

type Props = {
  agentId: string;
  agentName: string;
  tasks: TaskView[];
  /** True in the narrow panel beside the chat, which stacks the form's fields. */
  compact?: boolean;
};

const DEFAULT_SCHEDULE = "0 9 * * 1-5";

/**
 * Tasks: what an agent does on its own.
 *
 * The form talks in presets ("every weekday at 09:00") and keeps a cron expression
 * underneath, because that is what the scheduler reads and what a user who wants an odd
 * schedule can still write by hand. Everything is shown in the task's own timezone, and
 * the next run is worked out as you type — a schedule you can't see the consequences of
 * is a schedule you find out about at 3am.
 */
export default function AgentTasks({ agentId, agentName, tasks: fromServer, compact = false }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [, startAction] = useTransition();

  /**
   * Changes made here that the page hasn't caught up with yet: a saved task by id, or
   * null for one deleted. Each action answers with what it changed, which arrives well
   * before the page's own refresh, so without this a new task vanished for several seconds
   * after "Create task" and looked as if it hadn't saved. When fresh tasks arrive from the
   * server they already include these changes, so the list goes back to them.
   */
  const [local, setLocal] = useState<{ base: TaskView[]; changes: Record<string, TaskView | null> }>(
    { base: fromServer, changes: {} },
  );
  let changes = local.changes;
  if (local.base !== fromServer) {
    changes = {};
    setLocal({ base: fromServer, changes });
  }
  const tasks = withChanges(fromServer, changes);

  const record = (id: string, task: TaskView | null) =>
    setLocal((current) => ({ ...current, changes: { ...current.changes, [id]: task } }));

  const apply = (result: TaskActionResult) => {
    if (!("ok" in result)) return;
    if (result.task) record(result.task.id, result.task);
    if (result.removed) record(result.removed, null);
  };

  const act = (taskId: string, run: () => Promise<TaskActionResult>) => {
    setError(null);
    setMessage(null);
    setBusyTask(taskId);
    startAction(async () => {
      const result = await run();
      setBusyTask(null);
      if ("error" in result) setError(result.error);
      else {
        apply(result);
        if (result.message) setMessage(result.message);
      }
    });
  };

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Tasks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What {agentName} does without being asked. Each run starts fresh — no chat history —
            and the result is delivered where you say.
          </p>
        </div>
        {editing === null && tasks.length < TASK_LIMITS.maxPerAgent && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            New task
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}

      {editing === "new" && (
        <TaskForm
          agentId={agentId}
          compact={compact}
          onSaved={apply}
          onDone={() => setEditing(null)}
          onError={setError}
        />
      )}

      {tasks.length === 0 && editing === null && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <CalendarClock className="size-8 text-muted-foreground" />
          <h3 className="font-semibold">No tasks yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            A task is an instruction plus a time — &ldquo;every weekday at 9:00, summarise my unread
            email&rdquo;. {agentName} runs it on its own and sends you the result.
          </p>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            New task
          </Button>
        </div>
      )}

      <ul className="mt-5 flex flex-col gap-3">
        {tasks.map((task) =>
          editing === task.id ? (
            <li key={task.id}>
              <TaskForm
                agentId={agentId}
                task={task}
                compact={compact}
                onSaved={apply}
                onDone={() => setEditing(null)}
                onError={setError}
              />
            </li>
          ) : (
            <li key={task.id} className="rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.name}</span>
                    {!task.enabled && <Badge variant="outline">Paused</Badge>}
                    {task.trigger === "manual" && <Badge variant="outline">Manual only</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.prompt}</p>
                  <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="size-3.5" />
                      {task.trigger === "schedule" && task.schedule
                        ? `${describeSchedule(task.schedule)} · ${task.timezone}`
                        : "Only when you run it"}
                    </div>
                    {task.enabled && task.nextRunAt && (
                      <div>Next {formatDistanceToNow(new Date(task.nextRunAt), { addSuffix: true })}</div>
                    )}
                    {task.lastRunAt && (
                      <div>
                        Last run {formatDistanceToNow(new Date(task.lastRunAt), { addSuffix: true })}
                        {task.lastStatus ? ` · ${task.lastStatus.replace("_", " ")}` : ""}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">{describeDelivery(task.deliver)}</div>
                  </dl>
                </div>
                <Switch
                  checked={task.enabled}
                  disabled={busyTask === task.id}
                  onCheckedChange={(checked) => act(task.id, () => toggleTask(task.id, Boolean(checked)))}
                  aria-label={`Enable ${task.name}`}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyTask === task.id}
                  onClick={() => act(task.id, () => runTaskNow(task.id))}
                >
                  {busyTask === task.id ? <Loader2 className="animate-spin" /> : <Play />}
                  Run now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(task.id)}>
                  Edit
                </Button>
                {task.lastRunId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    render={<Link href={`/workspace/agent/${agentId}/runs/${task.lastRunId}`} />}
                  >
                    Last run
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busyTask === task.id}
                  onClick={() => {
                    if (!window.confirm(`Delete "${task.name}"? Its past runs are kept.`)) return;
                    act(task.id, () => removeTask(task.id));
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * The server's list with this screen's unconfirmed changes on top: new tasks first (the
 * list is newest first), edits in place, deletions left out. A saved task doesn't carry
 * its last run, so that is kept from the version being replaced.
 */
function withChanges(tasks: TaskView[], changes: Record<string, TaskView | null>) {
  const known = new Set(tasks.map((task) => task.id));
  const added = Object.values(changes).filter(
    (task): task is TaskView => task !== null && !known.has(task.id),
  );
  const kept = tasks.flatMap((task) => {
    if (!(task.id in changes)) return [task];
    const changed = changes[task.id];
    if (!changed) return [];
    return [{ ...changed, lastStatus: task.lastStatus, lastRunId: task.lastRunId }];
  });
  return [...added.reverse(), ...kept];
}

/** Which delivery channels a task uses, in words rather than keys. */
function describeDelivery(deliver: string[]) {
  const parts: React.ReactNode[] = [];
  if (deliver.includes("inapp")) {
    parts.push(
      <span key="inapp" className="flex items-center gap-1">
        <Inbox className="size-3.5" />
        Inbox
      </span>,
    );
  }
  if (deliver.includes("email")) {
    parts.push(
      <span key="email" className="flex items-center gap-1">
        <Mail className="size-3.5" />
        Email
      </span>,
    );
  }
  if (parts.length === 0) return <span>Run log only</span>;
  return <>{parts}</>;
}

type FormProps = {
  agentId: string;
  task?: TaskView;
  compact: boolean;
  /** Called with a successful save, before the form closes, to show it straight away. */
  onSaved: (result: TaskActionResult) => void;
  onDone: () => void;
  onError: (error: string | null) => void;
};

/** The presets the form offers. "Custom" hands over the cron expression itself. */
type Preset = "daily" | "weekdays" | "weekly" | "hourly" | "quarter" | "custom";

function TaskForm({ agentId, task, compact, onSaved, onDone, onError }: FormProps) {
  const initial = task?.schedule ?? DEFAULT_SCHEDULE;
  const read = fromCron(initial);

  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [manual, setManual] = useState(task?.trigger === "manual");
  const [preset, setPreset] = useState<Preset>(read.preset);
  const [time, setTime] = useState(read.time);
  const [weekday, setWeekday] = useState(read.weekday);
  const [custom, setCustom] = useState(initial);
  const [timezone, setTimezone] = useState(
    task?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const [deliver, setDeliver] = useState<string[]>(task?.deliver ?? ["inapp"]);
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [isSaving, startSaving] = useTransition();

  const schedule = preset === "custom" ? custom.trim() : toCron(preset, time, weekday);
  const next = manual ? null : nextOccurrence(schedule, timezone);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError(null);

    const input: TaskFormInput = {
      name,
      prompt,
      trigger: manual ? "manual" : "schedule",
      schedule,
      timezone,
      deliver,
      enabled,
    };

    startSaving(async () => {
      const result = await saveTask(agentId, task?.id ?? null, input);
      if ("error" in result) onError(result.error);
      else {
        onSaved(result);
        onDone();
      }
    });
  };

  const toggleChannel = (channel: string, on: boolean) =>
    setDeliver((current) =>
      on ? [...new Set([...current, channel])] : current.filter((entry) => entry !== channel),
    );

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4 rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="task-name">Name</Label>
        <Input
          id="task-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Morning inbox summary"
          maxLength={TASK_LIMITS.maxName}
          required
          disabled={isSaving}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="task-prompt">What should it do?</Label>
        <Textarea
          id="task-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Summarise my unread email from the last day, grouped by sender, and say what needs a reply."
          maxLength={TASK_LIMITS.maxPrompt}
          rows={4}
          required
          disabled={isSaving}
          className="min-h-24 resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Written as an instruction to the agent, the same as a chat message. It runs with the tools
          you have switched on for this agent.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Label>When</Label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            size="sm"
            checked={!manual}
            onCheckedChange={(checked) => setManual(!checked)}
            disabled={isSaving}
          />
          <span className="text-muted-foreground">On a schedule</span>
        </label>

        {!manual && (
          <div className={compact ? "flex flex-col gap-3" : "flex flex-wrap items-end gap-3"}>
            <NativeSelect
              value={preset}
              aria-label="How often"
              disabled={isSaving}
              onChange={(event) => setPreset(event.target.value as Preset)}
            >
              <NativeSelectOption value="daily">Every day</NativeSelectOption>
              <NativeSelectOption value="weekdays">Every weekday</NativeSelectOption>
              <NativeSelectOption value="weekly">Every week</NativeSelectOption>
              <NativeSelectOption value="hourly">Every hour</NativeSelectOption>
              <NativeSelectOption value="quarter">Every 15 minutes</NativeSelectOption>
              <NativeSelectOption value="custom">Custom (cron)</NativeSelectOption>
            </NativeSelect>

            {preset === "weekly" && (
              <NativeSelect
                value={String(weekday)}
                aria-label="Day of the week"
                disabled={isSaving}
                onChange={(event) => setWeekday(Number(event.target.value))}
              >
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                  (day, index) => (
                    <NativeSelectOption key={day} value={String(index)}>
                      {day}
                    </NativeSelectOption>
                  ),
                )}
              </NativeSelect>
            )}

            {(preset === "daily" || preset === "weekdays" || preset === "weekly") && (
              <Input
                type="time"
                value={time}
                aria-label="Time of day"
                disabled={isSaving}
                onChange={(event) => setTime(event.target.value || "09:00")}
                className="w-32"
              />
            )}

            {preset === "hourly" && (
              <Input
                type="number"
                min={0}
                max={59}
                value={Number(time.split(":")[1] ?? 0)}
                aria-label="Minutes past the hour"
                disabled={isSaving}
                onChange={(event) =>
                  setTime(`00:${String(clamp(Number(event.target.value), 0, 59)).padStart(2, "0")}`)
                }
                className="w-24"
              />
            )}

            {preset === "custom" && (
              <Input
                value={custom}
                aria-label="Cron expression"
                placeholder="0 9 * * 1-5"
                disabled={isSaving}
                onChange={(event) => setCustom(event.target.value)}
                className="font-mono"
              />
            )}
          </div>
        )}

        {!manual && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-timezone" className="text-xs font-normal text-muted-foreground">
              Timezone
            </Label>
            <Input
              id="task-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              disabled={isSaving}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              {next ? (
                <>
                  {describeSchedule(schedule)} — next run{" "}
                  <strong className="font-medium">{formatIn(next, timezone)}</strong> (
                  {formatDistanceToNow(next, { addSuffix: true })})
                </>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="size-3.5" />
                  That schedule never comes round. Check the expression and the timezone.
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Send the result to</Label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={deliver.includes("inapp")}
            onCheckedChange={(checked) => toggleChannel("inapp", Boolean(checked))}
            disabled={isSaving}
          />
          <span className="text-muted-foreground">My Omnix inbox</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={deliver.includes("email")}
            onCheckedChange={(checked) => toggleChannel("email", Boolean(checked))}
            disabled={isSaving}
          />
          <span className="text-muted-foreground">My email address</span>
        </label>
        <p className="text-xs text-muted-foreground">
          With neither ticked, the result is only in the run log. Email needs the server&apos;s email
          provider configured; if it isn&apos;t, the result still arrives in your inbox.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch
          size="sm"
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          disabled={isSaving}
        />
        <span className="text-muted-foreground">Enabled</span>
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving || !name.trim() || !prompt.trim()}>
          {isSaving ? <Loader2 className="animate-spin" /> : <Check />}
          {isSaving ? "Saving..." : task ? "Save task" : "Create task"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isSaving}>
          <X />
          Cancel
        </Button>
      </div>
    </form>
  );
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;

/** The preset and its settings as a cron expression. */
function toCron(preset: Preset, time: string, weekday: number) {
  const [hour, minute] = time.split(":").map((part) => clamp(Number(part), 0, 59));
  switch (preset) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${clamp(weekday, 0, 6)}`;
    case "hourly":
      return `${minute} * * * *`;
    case "quarter":
      return "*/15 * * * *";
    default:
      return `${minute} ${hour} * * *`;
  }
}

/** An existing expression back into the form's controls, or "custom" if it isn't one of them. */
function fromCron(expression: string): { preset: Preset; time: string; weekday: number } {
  const fallback = { preset: "custom" as Preset, time: "09:00", weekday: 1 };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
  if (!dayOfWeek || dayOfMonth !== "*" || month !== "*") return fallback;

  const isNumber = (value: string) => /^\d{1,2}$/.test(value);
  const at = (h: string, m: string) => `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

  if (minute === "*/15" && hour === "*" && dayOfWeek === "*") {
    return { preset: "quarter", time: "00:00", weekday: 1 };
  }
  if (isNumber(minute) && hour === "*" && dayOfWeek === "*") {
    return { preset: "hourly", time: at("00", minute), weekday: 1 };
  }
  if (!isNumber(minute) || !isNumber(hour)) return fallback;

  if (dayOfWeek === "*") return { preset: "daily", time: at(hour, minute), weekday: 1 };
  if (dayOfWeek === "1-5") return { preset: "weekdays", time: at(hour, minute), weekday: 1 };
  if (isNumber(dayOfWeek)) {
    return { preset: "weekly", time: at(hour, minute), weekday: Number(dayOfWeek) % 7 };
  }
  return fallback;
}

/** An instant as the clock reads it in the task's timezone. */
function formatIn(instant: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}
