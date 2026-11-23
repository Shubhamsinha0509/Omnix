import { db, messages } from "@/db";
import { claimApproval, findApprovalRun } from "@/lib/agent/approvals";
import { RUN_STREAM_CONTENT_TYPE, encodeEvent, type RunEvent } from "@/lib/agent/events";
import { resumeAgent } from "@/lib/agent/runner";
import { claimConversation, getOwnedAgent, releaseConversation } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";

const jsonError = (error: string, status: number, extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status });

/**
 * POST /api/approvals/:id  { decision: "approve" | "reject" }
 *
 * Acts on one approval card. What that means depends on what was waiting for it:
 *
 * - **A chat turn** has nothing running any more, so this request does the work and
 *   streams whatever the agent does next, in the same NDJSON format as a chat turn
 *   (D23). Approving performs the **stored** action and lets the agent carry on from
 *   where it paused; rejecting tells it so and lets it reply.
 * - **A background run** is still there, parked on `step.waitForEvent`. So this request
 *   only records the decision and sends the event; the run itself performs the action
 *   and finishes the job, and its result is delivered as usual (D41).
 *
 * Either way the decision is claimed with one conditional update, so two clicks cannot
 * make the same thing happen twice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: approvalId } = await params;

  const user = await getCurrentUser();
  if (!user) return jsonError("Please sign in again.", 401);

  const body = (await request.json().catch(() => null)) as { decision?: unknown } | null;
  const decision =
    body?.decision === "approve" ? "approved" : body?.decision === "reject" ? "rejected" : null;
  if (!decision) return jsonError("Tell me whether to approve or reject.", 400);

  const found = await findApprovalRun(user.id, approvalId);
  if (!found) return jsonError("That request is no longer available.", 404);
  if (found.status !== "pending") {
    // The usual cause is a second tab, so say what was decided rather than just failing.
    return jsonError(`This was already ${found.status}.`, 409, { status: found.status });
  }

  // The approval belongs to a run of this agent, and the agent must still be the user's.
  const agent = await getOwnedAgent(user.id, found.agentId);
  if (!agent) return jsonError("Agent not found.", 404);

  // A background run is waiting for this answer, so hand it over rather than doing the
  // work here. Claiming first means the card reads as decided straight away, and means a
  // second click can't send the event twice.
  if (found.taskId || found.trigger !== "chat") {
    const claimed = await claimApproval(user.id, approvalId, decision);
    if (!claimed) return jsonError("That request had already been decided or has expired.", 409);

    try {
      await inngest.send({
        id: `approval-${approvalId}-${decision}`,
        name: "approval/decided",
        data: { approvalId, decision },
      });
    } catch (error) {
      console.error("Couldn't tell the waiting run about an approval:", error);
      // The decision is recorded, so the run picks it up from the row when its wait ends.
      return jsonError(
        "Your decision was saved, but the agent couldn't be reached. It will act on it when it next checks.",
        502,
        { status: decision },
      );
    }

    return Response.json({ status: decision, background: true });
  }

  // Resuming is a turn in the conversation like any other, so it takes the same lease (D30).
  const conversationId = found.conversationId;
  if (conversationId) {
    const claim = await claimConversation(conversationId, user.id);
    if (claim === "missing") return jsonError("That chat no longer exists.", 404);
    if (claim === "busy") {
      return jsonError("This chat is busy answering. Wait for it to finish, then decide again.", 409);
    }
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: RunEvent) => {
        if (!closed) controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      let reply = "";
      try {
        const result = await resumeAgent({
          agent,
          user,
          approvalId,
          decision,
          signal: abort.signal,
          emit,
        });

        if (!result.ok) {
          emit({ t: "note", v: "That request had already been decided or has expired." });
        } else {
          reply = result.outcome.reply;
        }
      } catch (error) {
        console.error("Resuming after an approval failed:", error);
        emit({
          t: "note",
          v: "Something went wrong after the decision. Check the agent's runs before trying again.",
        });
      } finally {
        try {
          // Saved as its own message: the chat reads as reply → card → reply, which is
          // what happened. Tool activity and the card itself are not saved (D24).
          if (reply && conversationId) {
            await db.insert(messages).values({ conversationId, role: "assistant", content: reply });
          }
        } catch (error) {
          console.error("Failed to save the agent's reply:", error);
        }
        if (conversationId) {
          await releaseConversation(conversationId).catch((error) =>
            console.error("Failed to release conversation:", error),
          );
        }
        if (!closed) controller.close();
      }
    },
    cancel() {
      // The user navigated away. The action itself has already happened or not; only the
      // model's follow-up is abandoned.
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${RUN_STREAM_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store",
    },
  });
}
