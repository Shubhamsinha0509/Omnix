import { desc, eq } from "drizzle-orm";

import { conversations, db, messages } from "@/db";
import { RUN_STREAM_CONTENT_TYPE, encodeEvent, type RunEvent } from "@/lib/agent/events";
import { runAgent, type HistoryMessage } from "@/lib/agent/runner";
import {
  CONVERSATION_LEASE,
  claimConversation,
  getOwnedAgent,
  releaseConversation,
} from "@/lib/agents";
import { hasModelKey } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const MAX_MESSAGE = 8000;
const HISTORY_LIMIT = 40; // most recent messages sent to the model as context

const jsonError = (error: string, status: number) => Response.json({ error }, { status });

/**
 * POST /api/agents/:id/chat  { message, conversationId?, timezone? }
 *
 * Streams the agent's turn back as newline-delimited JSON events (decision D23): reply
 * text, the tools it used, and notes that are shown but never saved. The conversation id
 * is in the X-Conversation-Id response header (a new conversation starts when none is given).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;

  const user = await getCurrentUser();
  if (!user) return jsonError("Please sign in again.", 401);
  if (!hasModelKey()) {
    return jsonError("AI isn't set up yet: add OPENROUTER_API_KEY to .env and restart the dev server.", 503);
  }

  const body = (await request.json().catch(() => null)) as
    | { message?: unknown; conversationId?: unknown; timezone?: unknown }
    | null;
  const text = typeof body?.message === "string" ? body.message.trim() : "";
  const requestedConversation = typeof body?.conversationId === "string" ? body.conversationId : null;
  // The browser knows the user's timezone; without it dates default to UTC.
  const timezone = typeof body?.timezone === "string" && isValidTimezone(body.timezone) ? body.timezone : "UTC";
  if (!text) return jsonError("Message can't be empty.", 400);
  if (text.length > MAX_MESSAGE) return jsonError(`Message must be ${MAX_MESSAGE} characters or fewer.`, 400);

  // The agent must belong to the signed-in user.
  const agent = await getOwnedAgent(user.id, agentId);
  if (!agent) return jsonError("Agent not found.", 404);

  // Every message is a model turn that costs money: per minute, then per day.
  for (const limit of ["chatPerMinute", "chatPerDay"] as const) {
    const checked = await rateLimit(user.id, limit);
    if (!checked.ok) {
      return Response.json(
        { error: checked.error },
        { status: 429, headers: { "Retry-After": String(checked.retryAfterSeconds) } },
      );
    }
  }

  // Continue the given conversation, or start a new one — either way claiming it, so only
  // one turn at a time runs in it. Claiming is a single conditional UPDATE, so two
  // requests can't both win.
  let conversationId: string;
  if (requestedConversation) {
    const claim = await claimConversation(requestedConversation, user.id, agent.id);
    if (claim === "missing") return jsonError("Conversation not found.", 404);
    if (claim === "busy") {
      return jsonError("This chat is still answering your previous message. Wait for it to finish, then send again.", 409);
    }
    conversationId = requestedConversation;
  } else {
    const [created] = await db
      .insert(conversations)
      .values({
        agentId: agent.id,
        userId: user.id,
        title: text.slice(0, 60),
        busyUntil: CONVERSATION_LEASE,
      })
      .returning({ id: conversations.id });
    conversationId = created.id;
  }

  // From here on the lease is ours: every path out must release it.
  let history: HistoryMessage[];
  try {
    await db.insert(messages).values({ conversationId, role: "user", content: text });

    // Recent history, oldest first. The conversation should start with a user message.
    const recent = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(HISTORY_LIMIT);
    history = recent.reverse();
    while (history.length > 0 && history[0].role !== "user") history.shift();
  } catch (error) {
    await releaseConversation(conversationId).catch(() => {});
    throw error;
  }

  const abort = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: RunEvent) => {
        if (!closed) controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      let reply = "";
      try {
        const outcome = await runAgent({
          agent,
          user,
          trigger: "chat",
          conversationId,
          history,
          timezone,
          signal: abort.signal,
          emit,
        });
        reply = outcome.reply;
      } catch (error) {
        // runAgent handles its own failures; this is the unexpected kind.
        console.error("Agent chat failed:", error);
        emit({ t: "note", v: "Something went wrong while generating a reply. Please try again." });
      } finally {
        try {
          if (reply) {
            await db.insert(messages).values({ conversationId, role: "assistant", content: reply });
          }
        } catch (error) {
          console.error("Failed to save agent reply:", error);
        }
        // Success, failure or cancellation: the next message may now run.
        await releaseConversation(conversationId).catch((error) =>
          console.error("Failed to release conversation:", error),
        );
        if (!closed) controller.close();
      }
    },
    cancel() {
      // The user left or stopped the reply: stop generating tokens nobody will read.
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${RUN_STREAM_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Conversation-Id": conversationId,
    },
  });
}

function isValidTimezone(value: string) {
  if (value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
