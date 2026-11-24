import type { Agent, Task, User } from "@/db";
import { notify } from "@/lib/notifications";
import type { DeliveryChannel } from "@/lib/tasks";
import { hasEmailProvider, sendEmail } from "./email";

/**
 * Where a task's result goes once the run has finished.
 *
 * A background run nobody sees is only useful if its answer arrives somewhere, so this is
 * the last step of every task run: the in-app inbox, an email, or both, as the task says.
 *
 * Delivery never fails a run. The work is already done and logged by the time anything
 * here is called; a provider being down is reported, not raised, and a channel that
 * can't deliver falls back to in-app so a result is never lost in silence.
 */

export type DeliveryOutcome = { channel: DeliveryChannel | "inapp"; ok: boolean; detail?: string };

type DeliverInput = {
  user: User;
  agent: Agent;
  task: Pick<Task, "id" | "name" | "deliver">;
  runId: string;
  /** The agent's own words. Empty when the run failed before it said anything. */
  reply: string;
  /** Things the user should know that aren't part of the reply (a limit hit, an error). */
  notes?: string[];
  ok: boolean;
  error?: string | null;
};

export async function deliverTaskResult(input: DeliverInput): Promise<DeliveryOutcome[]> {
  const channels = new Set((input.task.deliver ?? []) as DeliveryChannel[]);
  const outcomes: DeliveryOutcome[] = [];

  const body = buildBody(input);
  const title = input.ok ? input.task.name : `${input.task.name} didn't finish`;

  if (channels.has("email")) {
    const outcome = await deliverEmail(input, title, body);
    outcomes.push(outcome);
    // Nothing is lost quietly: an email that didn't go out still lands in the inbox.
    if (!outcome.ok) channels.add("inapp");
  }

  if (channels.has("inapp")) {
    outcomes.push(await deliverInApp(input, title, body));
  }

  return outcomes;
}

async function deliverInApp(input: DeliverInput, title: string, body: string): Promise<DeliveryOutcome> {
  try {
    await notify({
      userId: input.user.id,
      kind: input.ok ? "task_result" : "task_failed",
      title,
      body,
      agentId: input.agent.id,
      taskId: input.task.id,
      runId: input.runId,
    });
    return { channel: "inapp", ok: true };
  } catch (error) {
    console.error("In-app delivery failed:", error);
    return { channel: "inapp", ok: false, detail: (error as Error)?.message ?? "unknown error" };
  }
}

async function deliverEmail(input: DeliverInput, title: string, body: string): Promise<DeliveryOutcome> {
  if (!hasEmailProvider()) {
    return { channel: "email", ok: false, detail: "Email delivery isn't configured on this server." };
  }
  if (!input.user.email) {
    return { channel: "email", ok: false, detail: "This account has no email address." };
  }

  const result = await sendEmail({
    to: input.user.email,
    subject: `${input.agent.name}: ${title}`,
    text: `${withFullLinks(body)}\n\n—\n${input.agent.name} ran this for you in Omnix${runLink(input)}`,
  });

  return result.ok ? { channel: "email", ok: true } : { channel: "email", ok: false, detail: result.error };
}

/** The result as text: the agent's reply, then anything that went wrong. */
function buildBody(input: DeliverInput) {
  const parts: string[] = [];
  if (input.reply.trim()) parts.push(input.reply.trim());
  if (!input.ok) parts.push(input.error?.trim() || "The run didn't finish and the agent gave no reply.");
  // A failed run often notes the same thing it failed with; say it once.
  for (const note of input.notes ?? []) {
    if (note.trim() && !parts.includes(note.trim())) parts.push(note.trim());
  }
  return parts.join("\n\n") || "The run finished without a reply.";
}

/**
 * Files an agent shared are linked as `/api/files/…`, which works in the app but not in an
 * email: there they need the app's own address in front. Without NEXT_PUBLIC_APP_URL they
 * are left as they are; the in-app copy still works.
 */
function withFullLinks(body: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return base ? body.replace(/\]\(\/api\/files\//g, `](${base}/api/files/`) : body;
}

function runLink(input: DeliverInput) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!base) return ".";
  return `: ${base}/workspace/agent/${input.agent.id}/runs/${input.runId}`;
}
