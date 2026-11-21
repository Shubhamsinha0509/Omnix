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
  Mail,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import {
  createEventParser,
  type Activity,
  type ApprovalDecision,
  type ApprovalRequest,
} from "@/lib/agent/events";
import type { ConversationSummary } from "@/lib/agents";
import { AgentAvatar } from "./AgentAvatar";
import AgentConfigPanel, { type AgentConfig } from "./AgentConfigPanel";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";

/** Width at which the configuration panel fits beside the chat; below it, it overlays. */
const PANEL_BREAKPOINT = "(min-width: 1280px)";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tools the agent used for this reply. Live only — past turns show the reply alone. */
  activity?: Activity[];
  /** Shown under the reply but never saved: errors, safety notices, limits that were hit. */
  notes?: string[];
  /** True only while this reply is still streaming. */
  pending?: boolean;
  /**
   * An action the agent wants to take that needs the user's agreement. Unlike activity,
   * this one survives a reload — it lives in the `approvals` table until it is decided.
   */
  approval?: ApprovalRequest;
  approvalState?: "pending" | "deciding" | ApprovalDecision;
};

/** A tool's icon in the activity list. Anything new falls back to a spanner. */
const TOOL_ICONS: Record<string, typeof Wrench> = {
  "web.search": Search,
  "web.fetch": Globe,
  "time.now": Clock,
  "gmail.search": Mail,
  "gmail.read": Mail,
  "gmail.create_draft": Mail,
  "gmail.send": Mail,
};

type Props = {
  agent: { id: string; name: string; avatarSeed: string; instructions: string };
  conversations: ConversationSummary[];
  initialConversationId: string | null;
  initialMessages: ChatMessage[];
  /** Cards still waiting in this conversation, so a reload doesn't lose them. */
  initialApprovals: ApprovalRequest[];
  aiReady: boolean;
  /** What the configuration panel beside the chat needs: tools, accounts, chat count. */
  config: AgentConfig;
};

/**
 * Turns the saved history plus any undecided approvals into what the chat shows.
 *
 * A pending card arrives as its own entry rather than being folded into the last reply:
 * the reply was saved, the card wasn't part of it, and keeping them separate means the
 * conversation reads in the order it actually happened.
 */
function withApprovals(messages: ChatMessage[], approvals: ApprovalRequest[]): ChatMessage[] {
  if (approvals.length === 0) return messages;
  return [
    ...messages,
    ...approvals.map((approval) => ({
      id: `approval-${approval.id}`,
      role: "assistant" as const,
      content: "",
      approval,
      approvalState: "pending" as const,
    })),
  ];
}

export default function AgentChat({
  agent,
  conversations,
  initialConversationId,
  initialMessages,
  initialApprovals,
  aiReady,
  config,
}: Props) {
  const router = useRouter();
  /**
   * The configuration panel. "auto" (the start) shows it where it fits beside the chat
   * and hides it on narrower screens — decided in CSS, so server and browser agree.
   * Once the user toggles it, their choice wins.
   */
  const [panel, setPanel] = useState<"auto" | "open" | "closed">("auto");
  const togglePanel = () => {
    const visible = panel === "open" || (panel === "auto" && window.matchMedia(PANEL_BREAKPOINT).matches);
    setPanel(visible ? "closed" : "open");
  };
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [chat, setChat] = useState<ChatMessage[]>(() => withApprovals(initialMessages, initialApprovals));
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /**
   * Which request owns the chat right now. New chat and switching chats bump it, so a
   * request that was superseded can't touch the conversation id, the URL or refresh.
   */
  const requestRef = useRef(0);

  // The page re-renders with a different conversation when the user opens another chat
  // (or uses back/forward). Reset to it — but not when the "new" conversation is simply
  // the one this component already started, which happens after its first reply.
  const [shownFor, setShownFor] = useState(initialConversationId);
  const [resets, setResets] = useState(0);
  if (initialConversationId !== shownFor) {
    setShownFor(initialConversationId);
    if (initialConversationId !== conversationId) {
      setConversationId(initialConversationId);
      setChat(withApprovals(initialMessages, initialApprovals));
      setError(null);
      setIsStreaming(false);
      setResets((count) => count + 1);
    }
  }

  // After a reset, stop the previous chat's reply and disown its request.
  useEffect(() => {
    if (resets === 0) return;
    requestRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [resets]);

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

  /**
   * Opening a chat from the menu normally changes the page's props, which resets state
   * above. The exception is the chat the page already loaded (e.g. after New chat): its
   * props don't change, so reset to it here from the messages we already have.
   */
  const openChat = (id: string) => {
    if (id === initialConversationId && id !== conversationId) {
      requestRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setConversationId(id);
      setChat(withApprovals(initialMessages, initialApprovals));
      setError(null);
    }
  };

  const newChat = () => {
    requestRef.current++; // the in-flight request no longer owns this chat
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setConversationId(null);
    setChat([]);
    setError(null);
    syncUrl(null);
  };

  const patch = (id: string, change: (message: ChatMessage) => ChatMessage) =>
    setChat((prev) => prev.map((message) => (message.id === id ? change(message) : message)));

  /**
   * Reads one NDJSON run stream into a reply bubble (decision D23).
   *
   * Shared by sending a message and deciding an approval, because after a decision the
   * agent carries on exactly as it would mid-turn — same events, same rendering.
   */
  const streamInto = async (body: ReadableStream<Uint8Array>, replyId: string) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parse = createEventParser();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const event of parse(decoder.decode(value, { stream: true }))) {
        if (event.t === "text") {
          patch(replyId, (m) => ({ ...m, content: m.content + event.v }));
        } else if (event.t === "note") {
          patch(replyId, (m) => ({ ...m, notes: [...(m.notes ?? []), event.v] }));
        } else if (event.t === "approval") {
          patch(replyId, (m) => ({ ...m, approval: event.v, approvalState: "pending" }));
        } else {
          // Activities arrive twice: once running, once finished. Update in place.
          patch(replyId, (m) => {
            const activity = m.activity ?? [];
            const at = activity.findIndex((item) => item.id === event.id);
            const next: Activity = {
              id: event.id,
              tool: event.tool,
              label: event.label,
              status: event.status,
              detail: event.detail,
            };
            return { ...m, activity: at === -1 ? [...activity, next] : activity.with(at, next) };
          });
        }
      }
    }
  };

  /** Drops a reply bubble that never received anything, so a decision can't leave a blank. */
  const dropIfEmpty = (replyId: string) =>
    setChat((prev) =>
      prev.filter(
        (m) => m.id !== replyId || m.content || m.activity?.length || m.notes?.length || m.approval,
      ),
    );

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    const replyId = crypto.randomUUID();
    const ticket = ++requestRef.current;
    const owns = () => requestRef.current === ticket;
    setInput("");
    setError(null);
    setIsStreaming(true);
    setChat((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
      { id: replyId, role: "assistant", content: "", pending: true },
    ]);

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
      if (newId && newId !== conversationId && owns()) {
        startedNewChat = !conversationId;
        setConversationId(newId);
        syncUrl(newId);
      }

      await streamInto(res.body, replyId);
    } catch (err) {
      if ((err as Error).name !== "AbortError" && owns()) {
        setError((err as Error).message);
        // Put the message back so it isn't lost, and drop the empty reply bubble.
        setChat((prev) => prev.filter((m) => !(m.id === replyId && !m.content && !m.activity?.length)));
        setInput((current) => current || text);
      }
    } finally {
      // The reply is finished either way, so it stops showing "Thinking...".
      patch(replyId, (m) => ({ ...m, pending: false }));
      if (owns()) {
        setIsStreaming(false);
        abortRef.current = null;
        // Pick up the new chat's title in the history menu — only if the user is still on it.
        if (startedNewChat) router.refresh();
      }
    }
  };

  /**
   * Approves or rejects one card, then streams whatever the agent says next.
   *
   * The card is marked `deciding` first so a second click does nothing, and the server
   * claims the decision as well — the two together are why an email can't go out twice.
   */
  const decide = async (card: ChatMessage, decision: "approve" | "reject") => {
    const approval = card.approval;
    if (!approval || isStreaming || card.approvalState !== "pending") return;

    const replyId = crypto.randomUUID();
    const ticket = ++requestRef.current;
    const owns = () => requestRef.current === ticket;

    patch(card.id, (m) => ({ ...m, approvalState: "deciding" }));
    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; status?: ApprovalDecision }
          | null;
        // Decided in another tab: show what it actually became rather than re-offering it.
        patch(card.id, (m) => ({ ...m, approvalState: data?.status ?? "pending" }));
        throw new Error(data?.error ?? "Couldn't record that decision. Please try again.");
      }

      patch(card.id, (m) => ({
        ...m,
        approvalState: decision === "approve" ? "approved" : "rejected",
      }));
      setChat((prev) => [...prev, { id: replyId, role: "assistant", content: "", pending: true }]);

      await streamInto(res.body, replyId);
    } catch (err) {
      if ((err as Error).name !== "AbortError" && owns()) setError((err as Error).message);
      // The request never landed (or never answered), so the decision wasn't recorded.
      // Offer the buttons again rather than leaving the card stuck on "Working...".
      patch(card.id, (m) => (m.approvalState === "deciding" ? { ...m, approvalState: "pending" } : m));
    } finally {
      patch(replyId, (m) => ({ ...m, pending: false }));
      dropIfEmpty(replyId);
      if (owns()) {
        setIsStreaming(false);
        abortRef.current = null;
        // The card is no longer pending on the server, so the page's props should agree.
        router.refresh();
      }
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
    <div className="flex h-svh">
      <div className="flex min-w-0 flex-1 flex-col">
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
              {/* Base UI requires a menu label to sit inside a group. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Past chats</DropdownMenuLabel>
                {conversations.map((chatItem) => (
                  <DropdownMenuItem
                    key={chatItem.id}
                    render={<Link href={`/workspace/agent/${agent.id}?c=${chatItem.id}`} />}
                    onClick={() => openChat(chatItem.id)}
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
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="outline" size="sm" onClick={newChat} disabled={chat.length === 0}>
          <SquarePen />
          New chat
        </Button>

        <Button
          variant={panel === "open" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Agent configuration"
          title="Agent configuration"
          onClick={togglePanel}
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
                    message.pending &&
                    !message.activity?.length &&
                    !message.approval && (
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

                  {message.approval && (
                    <ApprovalCard
                      request={message.approval}
                      state={message.approvalState ?? "pending"}
                      busy={isStreaming}
                      onDecide={(decision) => void decide(message, decision)}
                    />
                  )}
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

      {/* Agent configuration: beside the chat where it fits, over it on narrower screens. */}
      <aside
        aria-label="Agent configuration"
        className={[
          "w-[380px] max-w-full shrink-0 flex-col border-l bg-background",
          panel === "closed" && "hidden",
          panel === "auto" && "hidden xl:flex",
          panel === "open" && "fixed inset-y-0 right-0 z-30 flex shadow-2xl xl:static xl:z-auto xl:shadow-none",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <AgentConfigPanel
          agent={agent}
          {...config}
          onClose={() => setPanel("closed")}
        />
      </aside>
    </div>
  );
}
