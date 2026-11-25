"use server";

import { revalidatePath } from "next/cache";

import { getOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";
import { inngestConfigProblems, inngestMode } from "@/lib/inngest/config";
import { rateLimit } from "@/lib/rate-limit";
import { isValidTimezone, validateSchedule } from "@/lib/schedule/cron";
import {
  DELIVERY_CHANNELS,
  TASK_LIMITS,
  countTasks,
  createTask,
  deleteTask,
  getOwnedTask,
  setTaskEnabled,
  toTaskView,
  updateTask,
  type DeliveryChannel,
  type TaskInput,
  type TaskView,
} from "@/lib/tasks";
import type { Task } from "@/db";

/**
 * Server actions for tasks. Everything the form sends is checked again here: the schedule
 * has to parse and be inside our rate rules, the timezone has to be a real one, and the
 * agent and task have to belong to the person asking (D14).
 */

/**
 * `task` is the task as saved and `removed` the id of one deleted, so the screen can show
 * the change at once. The page's own refresh (from `revalidatePath`) follows, but it
 * re-reads the whole agent page and can take several seconds to arrive.
 */
export type TaskActionResult =
  | { error: string }
  | { ok: true; message?: string; task?: TaskView; removed?: string };

/** A just-saved row as the browser sees it. Its last run is filled in by the screen. */
const view = (task: Task) => toTaskView({ ...task, lastStatus: null, lastRunId: null });

export type TaskFormInput = {
  name: string;
  prompt: string;
  trigger: "manual" | "schedule";
  schedule: string;
  timezone: string;
  deliver: string[];
  enabled: boolean;
};

function validate(input: TaskFormInput): { error: string } | { values: TaskInput } {
  const name = input.name?.trim() ?? "";
  const prompt = input.prompt?.trim() ?? "";

  if (!name) return { error: "Give the task a name." };
  if (name.length > TASK_LIMITS.maxName) {
    return { error: `The name must be ${TASK_LIMITS.maxName} characters or fewer.` };
  }
  if (!prompt) return { error: "Say what the agent should do each time this runs." };
  if (prompt.length > TASK_LIMITS.maxPrompt) {
    return { error: `The instruction must be ${TASK_LIMITS.maxPrompt} characters or fewer.` };
  }

  const trigger = input.trigger === "manual" ? "manual" : "schedule";
  let schedule: string | null = null;

  if (trigger === "schedule") {
    const expression = input.schedule?.trim() ?? "";
    if (!expression) return { error: "Choose when this task should run." };
    const checked = validateSchedule(expression);
    if (!checked.ok) return { error: checked.error };
    schedule = expression;
  }

  if (!isValidTimezone(input.timezone)) {
    return { error: "That timezone isn't one I recognise." };
  }

  const deliver = (input.deliver ?? []).filter((channel): channel is DeliveryChannel =>
    (DELIVERY_CHANNELS as readonly string[]).includes(channel),
  );

  return {
    values: {
      name,
      prompt,
      trigger,
      schedule,
      timezone: input.timezone,
      deliver,
      enabled: Boolean(input.enabled),
    },
  };
}

/** Creates a task, or saves an existing one when `taskId` is given. */
export async function saveTask(
  agentId: string,
  taskId: string | null,
  input: TaskFormInput,
): Promise<TaskActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  const agent = await getOwnedAgent(user.id, agentId);
  if (!agent) return { error: "Agent not found." };

  const checked = validate(input);
  if ("error" in checked) return checked;

  let saved: Task | null | undefined;
  try {
    if (taskId) {
      const existing = await getOwnedTask(user.id, taskId);
      if (!existing || existing.agentId !== agent.id) return { error: "Task not found." };
      saved = await updateTask(taskId, user.id, checked.values);
      if (!saved) return { error: "Task not found." };
    } else {
      if ((await countTasks(agent.id)) >= TASK_LIMITS.maxPerAgent) {
        return { error: `An agent can have ${TASK_LIMITS.maxPerAgent} tasks. Delete one first.` };
      }
      saved = await createTask(agent, checked.values);
    }
  } catch (error) {
    console.error("Failed to save the task:", error);
    return { error: "Couldn't save that task. Please try again." };
  }

  revalidate(agent.id);
  return { ok: true, task: saved ? view(saved) : undefined };
}

export async function toggleTask(taskId: string, enabled: boolean): Promise<TaskActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  const task = await getOwnedTask(user.id, taskId);
  if (!task) return { error: "Task not found." };

  const updated = await setTaskEnabled(taskId, user.id, enabled);
  if (!updated) return { error: "Couldn't change that task. Please try again." };

  revalidate(task.agentId);
  return { ok: true, task: view(updated) };
}

export async function removeTask(taskId: string): Promise<TaskActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  const task = await getOwnedTask(user.id, taskId);
  if (!task) return { error: "Task not found." };

  if (!(await deleteTask(taskId, user.id))) {
    return { error: "Couldn't delete that task. Please try again." };
  }

  revalidate(task.agentId);
  return { ok: true, removed: taskId };
}

/**
 * "Run now": asks Inngest to run the task immediately.
 *
 * The run itself happens in the background, exactly as a scheduled one does — same
 * function, same steps, same delivery — so this returns as soon as the request is
 * accepted rather than waiting for an agent to finish thinking.
 *
 * A disabled task can still be run this way on purpose: it is how you try one out before
 * letting it loose on a schedule.
 */
export async function runTaskNow(taskId: string): Promise<TaskActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in." };

  const task = await getOwnedTask(user.id, taskId);
  if (!task) return { error: "Task not found." };

  // Each press is a full background run; the daily cap (D45) still applies on top.
  const limited = await rateLimit(user.id, "runNowPerMinute");
  if (!limited.ok) return { error: limited.error };

  try {
    await inngest.send({
      // One run per task per minute: a double click is one run, two deliberate presses a
      // minute apart are two.
      id: `manual-${taskId}-${new Date().toISOString().slice(0, 16)}`,
      name: "agent/task.run",
      data: { taskId, trigger: "manual" },
    });
  } catch (error) {
    console.error("Failed to start a task run:", error);
    return {
      error:
        inngestMode() === "cloud"
          ? inngestConfigProblems().length > 0
            ? "Background jobs aren't configured on this server yet, so tasks can't run."
            : "Couldn't reach the background job service. Please try again in a moment."
          : "Couldn't reach the background job service. In development, run `npm run inngest:dev` in a second terminal.",
    };
  }

  revalidate(task.agentId);
  return { ok: true, message: `${task.name} is running. The result will arrive in your inbox.` };
}

function revalidate(agentId: string) {
  revalidatePath(`/workspace/agent/${agentId}/tasks`);
  revalidatePath(`/workspace/agent/${agentId}`);
}
