import { and, desc, eq } from "drizzle-orm";

import { conversations, db, messages } from "@/db";
import { RUN_STREAM_CONTENT_TYPE, encodeEvent, type RunEvent } from "@/lib/agent/events";
import { runAgent, type HistoryMessage } from "@/lib/agent/runner";
import { UUID_PATTERN, getOwnedAgent } from "@/lib/agents";
import { hasModelKey } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";

const MAX_MESSAGE = 8000;
const HISTORY_LIMIT = 40; // most recent messages sent to Gemini as context

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

  // Continue the given conversation, or start a new one.
  let conversationId: string;
  if (requestedConversation) {
    if (!UUID_PATTERN.test(requestedConversation)) return jsonError("Conversation not found.", 404);
    const [existing] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, requestedConversation),
          eq(conversations.agentId, agent.id),
          eq(conversations.userId, user.id),
        ),
      )
      .limit(1);
    if (!existing) return jsonError("Conversation not found.", 404);
    conversationId = existing.id;
  } else {
    const [created] = await db
      .insert(conversations)
      .values({ agentId: agent.id, userId: user.id, title: text.slice(0, 60) })
      .returning({ id: conversations.id });
    conversationId = created.id;
  }

  await db.insert(messages).values({ conversationId, role: "user", content: text });

  // Recent history, oldest first. The conversation should start with a user message.
  const recent = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_LIMIT);
  const history: HistoryMessage[] = recent.reverse();
  while (history.length > 0 && history[0].role !== "user") history.shift();

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
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId));
        } catch (error) {
          console.error("Failed to save agent reply:", error);
        }
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
