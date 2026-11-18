"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUp,
  Check,
  Clock,
  Globe,
  History,
  Loader2,
  Search,
  Settings,
  SquarePen,
  Square,
  TriangleAlert,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { createEventParser, type Activity } from "@/lib/agent/events";
import type { ConversationSummary } from "@/lib/agents";
import { AgentAvatar } from "./AgentAvatar";
import { Markdown } from "./Markdown";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tools the agent used for this reply. Live only — past turns show the reply alone. */
  activity?: Activity[];
  /** Shown under the reply but never saved: errors, safety notices, limits that were hit. */
  notes?: string[];
};

/** A tool's icon in the activity list. Anything new falls back to a spanner. */
const TOOL_ICONS: Record<string, typeof Wrench> = {
  "web.search": Search,
  "web.fetch": Globe,
  "time.now": Clock,
};

type Props = {
  agent: { id: string; name: string; avatarSeed: string; instructions: string };
  conversations: ConversationSummary[];
  initialConversationId: string | null;
  initialMessages: ChatMessage[];
  aiReady: boolean;
};

export default function AgentChat({
  agent,
  conversations,
  initialConversationId,
  initialMessages,
  aiReady,
}: Props) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [chat, setChat] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat]);

  // Stop any in-flight reply when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Points the address bar at a chat without re-rendering the page (so streaming survives). */
  const syncUrl = (id: string | null) => {
    const url = id ? `/workspace/agent/${agent.id}?c=${id}` : `/workspace/agent/${agent.id}`;
    window.history.replaceState(null, "", url);
  };

  const newChat = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setChat([]);
    setError(null);
    syncUrl(null);
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    const replyId = crypto.randomUUID();
    setInput("");
    setError(null);
    setIsStreaming(true);
    setChat((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
      { id: replyId, role: "assistant", content: "" },
    ]);

    const updateReply = (change: (message: ChatMessage) => ChatMessage) =>
      setChat((prev) => prev.map((m) => (m.id === replyId ? change(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    // A brand-new chat needs the conversation list refreshed once the reply is done.
    let startedNewChat = false;

    try {
      const res = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
          // So "today" and "this afternoon" mean what the user means.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Something went wrong. Please try again.");
      }

      const newId = res.headers.get("X-Conversation-Id");
      if (newId && newId !== conversationId) {
        startedNewChat = !conversationId;
        setConversationId(newId);
        syncUrl(newId);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parse = createEventParser();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parse(decoder.decode(value, { stream: true }))) {
          if (event.t === "text") {
            updateReply((m) => ({ ...m, content: m.content + event.v }));
          } else if (event.t === "note") {
            updateReply((m) => ({ ...m, notes: [...(m.notes ?? []), event.v] }));
          } else {
            // Activities arrive twice: once running, once finished. Update in place.
            updateReply((m) => {
              const activity = m.activity ?? [];
              const at = activity.findIndex((item) => item.id === event.id);
              const next: Activity = {
                id: event.id,
                tool: event.tool,
                label: event.label,
                status: event.status,
                detail: event.detail,
              };
              return {
                ...m,
                activity: at === -1 ? [...activity, next] : activity.with(at, next),
              };
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
        // Put the message back so it isn't lost, and drop the empty reply bubble.
        setChat((prev) => prev.filter((m) => !(m.id === replyId && !m.content && !m.activity?.length)));
        setInput((current) => current || text);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // Pick up the new chat's title in the history menu.
      if (startedNewChat) router.refresh();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter adds a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-svh flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b px-6 py-3">
        <div className="size-9 shrink-0">
          <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
        </div>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{agent.name}</h1>

        {conversations.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm">
                  <History />
                  Chats
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-72 min-w-72">
              <DropdownMenuLabel>Past chats</DropdownMenuLabel>
              {conversations.map((chatItem) => (
                <DropdownMenuItem
                  key={chatItem.id}
                  render={<Link href={`/workspace/agent/${agent.id}?c=${chatItem.id}`} />}
                >
                  <span className="min-w-0 flex-1 truncate">{chatItem.title}</span>
                  {chatItem.id === conversationId ? (
                    <Check className="text-muted-foreground" />
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(chatItem.updatedAt), { addSuffix: true })}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="outline" size="sm" onClick={newChat} disabled={chat.length === 0}>
          <SquarePen />
          New chat
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Agent settings"
          render={<Link href={`/workspace/agent/${agent.id}/settings`} />}
        >
          <Settings />
        </Button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
          {chat.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="size-16">
                <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
              </div>
              <h2 className="text-lg font-semibold">Chat with {agent.name}</h2>
              <p className="max-w-md text-sm text-muted-foreground line-clamp-3">
                {agent.instructions || "Ask anything to get started."}
              </p>
            </div>
          )}

          {chat.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex gap-3">
                <div className="mt-0.5 size-7 shrink-0">
                  <AgentAvatar seed={agent.avatarSeed} name={agent.name} />
                </div>
                <div className="min-w-0 flex-1 pt-1">
                  {message.activity && message.activity.length > 0 && (
                    <Trace className="mb-3">
                      {message.activity.map((item) => {
                        const Icon = TOOL_ICONS[item.tool] ?? Wrench;
                        return (
                          <TraceLine
                            key={item.id}
                            status={item.status === "done" ? undefined : item.status}
                          >
                            <TraceIcon>
                              {item.status === "running" ? (
                                <Loader2 className="animate-spin" />
                              ) : item.status === "error" ? (
                                <TriangleAlert />
                              ) : (
                                <Icon />
                              )}
                            </TraceIcon>
                            <TraceTitle>{item.label}</TraceTitle>
                            {item.detail && <TraceDescription>{item.detail}</TraceDescription>}
                          </TraceLine>
                        );
                      })}
                    </Trace>
                  )}

                  {message.content ? (
                    <Markdown content={message.content} />
                  ) : (
                    !message.activity?.length && (
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Thinking...
                      </span>
                    )
                  )}

                  {message.notes?.map((note, index) => (
                    <p key={index} className="mt-2 text-sm text-muted-foreground italic">
                      {note}
                    </p>
                  ))}
                </div>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-background px-6 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {!aiReady && (
            <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-4 shrink-0" />
              AI isn&apos;t set up yet: add OPENROUTER_API_KEY to .env and restart the dev server.
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <form
            onSubmit={send}
            className="flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-3 focus-within:ring-ring/50"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${agent.name}...`}
              rows={1}
              maxLength={8000}
              className="max-h-48 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {isStreaming ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop reply"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send message">
                <ArrowUp />
              </Button>
            )}
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Enter to send · Shift + Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
