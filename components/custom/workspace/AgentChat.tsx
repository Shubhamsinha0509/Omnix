"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  History,
  Loader2,
  PanelRight,
  Paperclip,
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
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import {
  createEventParser,
  type Activity,
  type ApprovalDecision,
  type ApprovalRequest,
} from "@/lib/agent/events";
import type { ConversationSummary } from "@/lib/agents";
import type { SandboxView } from "@/lib/sandbox";
import { ModelChip, SuggestionChip } from "@/components/custom/design/Chips";
import { HeroWash } from "@/components/custom/design/HeroWash";
import { TOOL_ICONS } from "@/components/custom/design/ToolPermissionRow";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./AgentAvatar";
import AgentConfigPanel, { type AgentConfig, type ConfigTab } from "./AgentConfigPanel";
import type { SetupRecommendation } from "@/lib/agent-guide";
import { ApprovalCard } from "./ApprovalCard";
import { SetupCard } from "./SetupCard";
import ChatRunPanel, { type SavedRun } from "./ChatRunPanel";
import { Markdown } from "./Markdown";


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
  /** Live replies only, for the run panel: when the turn started and ended (ms). */
  startedAt?: number;
  finishedAt?: number;
  /** When each step first arrived: activity ids, plus `reply` and `approval`. */
  times?: Record<string, number>;
};

/** Notes the first time a step shows up, so the run panel can say when it happened. */
const stamp = (message: ChatMessage, key: string): Record<string, number> | undefined =>
  message.startedAt === undefined || message.times?.[key] !== undefined
    ? message.times
    : { ...message.times, [key]: Date.now() };

type Props = {
  agent: { id: string; name: string; avatarSeed: string; instructions: string };
  conversations: ConversationSummary[];
  initialConversationId: string | null;
  initialMessages: ChatMessage[];
  /** Cards still waiting in this conversation, so a reload doesn't lose them. */
  initialApprovals: ApprovalRequest[];
  /** Why chat can't run on this server, worded for the reader (lib/ai.ts `modelNotice`); null when it can. */
  aiNotice: string | null;
  /** What the configuration panel beside the chat needs: tools, accounts, chat count. */
  config: AgentConfig;
  /** From Home's composer (`?prompt=`): sent as the first message of a new chat. */
  initialPrompt?: string | null;
  /** `?configure=instructions`: open the drawer on that tab. */
  initialTab?: ConfigTab | null;
  /** The agent's VM, for the run panel. */
  vm: { ready: boolean; initial: SandboxView };
  /** The open chat's most recent saved run, so the panel has it after a reload. */
  savedRun: SavedRun | null;
  /** Prompts offered in an empty chat (05-chat-empty), fitted to this agent (lib/agent-guide.ts). */
  starters: string[];
  /** Setup this agent's job still needs, shown in an empty chat until it's done. */
  setup: SetupRecommendation[];
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
  aiNotice,
  config,
  initialPrompt = null,
  initialTab = null,
  vm,
  savedRun,
  starters,
  setup,
}: Props) {
  const aiReady = !aiNotice;
  const router = useRouter();
  /** The configuration drawer: closed to start (05/06), open on a tab (07–10). */
  const [panelOpen, setPanelOpen] = useState(initialTab !== null);
  const [panelTab, setPanelTab] = useState<ConfigTab>(initialTab ?? "instructions");
  const openPanel = (tab?: ConfigTab) => {
    if (tab) setPanelTab(tab);
    setPanelOpen(true);
  };
  /**
   * The run panel (21-chat-run-panel). Two switches because it behaves differently by width:
   * docked beside the chat from 1024px (shown unless hidden), over the chat below that
   * (hidden unless opened).
   */
  const [runDocked, setRunDocked] = useState(true);
  const [runSheet, setRunSheet] = useState(false);
  const toggleRun = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) setRunDocked((open) => !open);
    else setRunSheet((open) => !open);
  };
  const closeRun = () => {
    setRunDocked(false);
    setRunSheet(false);
  };
  /** Which replies have their tool steps expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
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
          patch(replyId, (m) => ({ ...m, content: m.content + event.v, times: stamp(m, "reply") }));
        } else if (event.t === "note") {
          patch(replyId, (m) => ({ ...m, notes: [...(m.notes ?? []), event.v] }));
        } else if (event.t === "approval") {
          patch(replyId, (m) => ({ ...m, approval: event.v, approvalState: "pending", times: stamp(m, "approval") }));
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
            return {
              ...m,
              activity: at === -1 ? [...activity, next] : activity.with(at, next),
              times: stamp(m, event.id),
            };
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

  const send = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    const text = (override ?? input).trim();
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
      { id: replyId, role: "assistant", content: "", pending: true, startedAt: Date.now() },
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
      patch(replyId, (m) => ({ ...m, pending: false, finishedAt: Date.now() }));
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
      setChat((prev) => [
        ...prev,
        { id: replyId, role: "assistant", content: "", pending: true, startedAt: Date.now() },
      ]);

      await streamInto(res.body, replyId);
    } catch (err) {
      if ((err as Error).name !== "AbortError" && owns()) setError((err as Error).message);
      // The request never landed (or never answered), so the decision wasn't recorded.
      // Offer the buttons again rather than leaving the card stuck on "Working...".
      patch(card.id, (m) => (m.approvalState === "deciding" ? { ...m, approvalState: "pending" } : m));
    } finally {
      patch(replyId, (m) => ({ ...m, pending: false, finishedAt: Date.now() }));
      dropIfEmpty(replyId);
      if (owns()) {
        setIsStreaming(false);
        abortRef.current = null;
        // The card is no longer pending on the server, so the page's props should agree.
        router.refresh();
      }
    }
  };

  /**
   * A prompt from Home's composer: sent once as this new chat's first message, then dropped
   * from the address bar so a reload doesn't send it again. The timer (cleared on unmount)
   * keeps React's development double-mount from starting it twice or aborting it.
   */
  useEffect(() => {
    if (!initialPrompt) return;
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, "", `/workspace/agent/${agent.id}`);
      void send(undefined, initialPrompt);
    }, 0);
    return () => window.clearTimeout(timer);
    // Once per page load, with the prompt the page arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyReply = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
      window.setTimeout(() => setCopied((current) => (current === message.id ? null : current)), 1500);
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing useful to show.
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter adds a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const empty = chat.length === 0;
  const gmailOn = config.tools.some((tool) => tool.provider === "gmail" && tool.enabled);
  /** The run the panel follows: the newest reply started from this page. */
  const currentRun = chat.findLast((message) => message.role === "assistant" && message.startedAt !== undefined) ?? null;
  const runShown = runDocked || runSheet;

  return (
    <div className="relative flex h-[calc(100svh-3.5rem)] md:h-svh">
      <section aria-label={`Chat with ${agent.name}`} className="flex min-w-0 flex-1 flex-col">
        {/* Header (05/06): avatar, name, model, chats, new chat, configuration */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-6">
          <span className="size-8 shrink-0">
            <AgentAvatar seed={agent.avatarSeed} name="" />
          </span>
          <h1 className="min-w-0 flex-1 truncate font-sans text-h3 font-semibold tracking-normal">
            {agent.name}
          </h1>
          <span title={config.model.id} className="hidden md:inline-flex">
            <ModelChip label={config.model.label} />
          </span>

          {conversations.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="max-md:size-10 max-md:px-0" aria-label="Chats">
                    <History />
                    <span className="hidden md:inline">Chats</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-72 min-w-72">
                {/* Base UI requires a menu label to sit inside a group. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-3 py-1.5 text-caption">Past chats</DropdownMenuLabel>
                  {conversations.map((chatItem) => (
                    <DropdownMenuItem
                      key={chatItem.id}
                      render={<Link href={`/workspace/agent/${agent.id}?c=${chatItem.id}`} />}
                      onClick={() => openChat(chatItem.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{chatItem.title}</span>
                      {chatItem.id === conversationId ? (
                        <Check />
                      ) : (
                        <span className="shrink-0 text-caption text-muted-foreground">
                          {formatDistanceToNow(new Date(chatItem.updatedAt), { addSuffix: true })}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={newChat}
            disabled={empty}
            aria-label="New chat"
            className="max-md:size-10 max-md:px-0"
          >
            <SquarePen />
            <span className="hidden md:inline">New chat</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label={runShown ? "Hide run panel" : "Show run panel"}
            title="Run panel"
            onClick={toggleRun}
            className={cn(
              // Lit only where the panel is actually showing at this width.
              runSheet && "max-lg:bg-accent max-lg:text-brand",
              runDocked && !panelOpen && "lg:bg-accent lg:text-brand",
            )}
          >
            <PanelRight />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Agent configuration"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
            className={cn(panelOpen && "bg-accent text-brand hover:bg-accent hover:text-brand")}
          >
            <Settings />
          </Button>
        </header>

        {/* Messages */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {empty ? (
            <div className="relative flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
              <HeroWash className="top-0 h-full" />
              <span className="relative size-20">
                <AgentAvatar seed={agent.avatarSeed} name="" />
              </span>
              <h2 className="relative font-display text-[32px] leading-9 font-semibold tracking-[-0.02em] md:text-[40px] md:leading-[44px]">
                Chat with {agent.name}
              </h2>
              <p className="relative line-clamp-3 max-w-[520px] text-body-l text-muted-foreground">
                {agent.instructions.trim()
                  ? agent.instructions
                  : `${agent.name} has no instructions yet, so it works as a general assistant${gmailOn ? " with Gmail access" : ""}.`}
              </p>
              {!agent.instructions.trim() && (
                <Button variant="outline" className="relative" onClick={() => openPanel("instructions")}>
                  Add instructions
                </Button>
              )}
              <div className="relative flex flex-wrap justify-center gap-2 pt-4">
                {starters.map((suggestion) => (
                  <SuggestionChip
                    key={suggestion}
                    disabled={isStreaming || !aiReady}
                    onClick={() => void send(undefined, suggestion)}
                  >
                    {suggestion}
                  </SuggestionChip>
                ))}
              </div>
              {/* What this agent's job still needs, from its instructions (lib/agent-guide.ts). */}
              <SetupCard
                agentId={agent.id}
                agentName={agent.name}
                recommendations={setup}
                className="relative mt-4 max-w-[560px]"
              />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-[840px] flex-col gap-6 px-4 py-6 md:px-8">
              {chat.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-[20px_20px_8px_20px] bg-primary px-4 py-2.5 whitespace-pre-wrap text-primary-foreground md:max-w-[70%]">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div key={message.id} className="flex items-start gap-3">
                    <span className="size-8 shrink-0">
                      <AgentAvatar seed={agent.avatarSeed} name="" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      {message.activity && message.activity.length > 0 && (
                        <ToolUse
                          activity={message.activity}
                          open={expanded.has(message.id)}
                          onToggle={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(message.id)) next.delete(message.id);
                              else next.add(message.id);
                              return next;
                            })
                          }
                        />
                      )}

                      {message.content ? (
                        <Markdown content={message.content} />
                      ) : (
                        message.pending &&
                        !message.activity?.length &&
                        !message.approval && (
                          <span className="inline-flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Thinking…
                          </span>
                        )
                      )}

                      {message.notes?.map((note, index) => (
                        <p key={index} className="text-body-s text-muted-foreground italic">
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

                      {message.content && !message.pending && (
                        <div className="flex gap-1 text-muted-foreground">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={copied === message.id ? "Copied" : "Copy reply"}
                            onClick={() => void copyReply(message)}
                          >
                            {copied === message.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="flex shrink-0 flex-col items-center gap-2 px-4 pt-3 pb-5 md:px-6">
          {aiNotice && (
            <p className="flex w-full max-w-[780px] items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-body-s text-warning-text">
              <TriangleAlert className="size-4 shrink-0" />
              {aiNotice}
            </p>
          )}
          {error && (
            <p role="alert" className="w-full max-w-[780px] rounded-md bg-destructive/10 px-3 py-2 text-body-s text-destructive">
              {error}
            </p>
          )}
          <form
            onSubmit={send}
            className="flex w-full max-w-[780px] items-end gap-3 rounded-xl border border-input bg-card py-2 pr-2 pl-4 shadow-sm focus-within:border-ring"
          >
            {/* TODO(backend): attachments — the chat API takes text only for now. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Attach a file"
              title="Attachments are coming soon"
              disabled
              className="mb-1"
            >
              <Paperclip />
            </Button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Message ${agent.name}…`}
              aria-label={`Message ${agent.name}`}
              rows={1}
              maxLength={8000}
              className="field-sizing-content max-h-48 min-h-10 flex-1 resize-none bg-transparent py-2 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:shadow-none!"
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
              <Button type="submit" variant="brand" size="icon" disabled={!input.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </form>
          <p className="hidden text-caption font-medium text-muted-foreground md:block">
            Enter to send · Shift + Enter for a new line
          </p>
        </div>
      </section>

      {/* Run panel (21): beside the chat from 1024px, over it below. The configuration
          drawer takes its place while open, so the chat never gets squeezed by both. */}
      {!panelOpen && runShown && (
        <aside
          aria-label="Run panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeRun();
          }}
          className={cn(
            // Flush to the right edge, full height, one divider: the mirror of the sidebar.
            "absolute inset-0 z-30 flex lg:static lg:w-[380px] lg:shrink-0 lg:border-l xl:w-[440px]",
            !runSheet && "max-lg:hidden",
            !runDocked && "lg:hidden",
          )}
        >
          <ChatRunPanel
            agentId={agent.id}
            run={currentRun}
            // Only for the chat it belongs to: not after New chat, nor in another chat.
            savedRun={savedRun?.conversationId === conversationId ? savedRun : null}
            vm={vm}
            onStop={() => abortRef.current?.abort()}
            onClose={closeRun}
          />
        </aside>
      )}

      {/* Configuration drawer (07–10): beside the chat on wide screens, over it below 1280px. */}
      {panelOpen && (
        <aside
          aria-label="Agent configuration"
          onKeyDown={(event) => {
            if (event.key === "Escape") setPanelOpen(false);
          }}
          className="glass absolute inset-0 z-30 flex flex-col overflow-hidden p-5 shadow-lg md:inset-y-3 md:right-3 md:left-auto md:w-[400px] md:rounded-xl xl:static xl:my-3 xl:mr-3 xl:shrink-0"
        >
          <AgentConfigPanel
            agent={agent}
            {...config}
            tab={panelTab}
            onTabChange={setPanelTab}
            onClose={() => setPanelOpen(false)}
          />
        </aside>
      )}
    </div>
  );
}

/** "Used gmail.search and gmail.read ×5": each tool once, repeats counted, in first-use order. */
function summarize(activity: Activity[]) {
  const counts = new Map<string, number>();
  for (const item of activity) counts.set(item.tool, (counts.get(item.tool) ?? 0) + 1);
  return [...counts].map(([tool, count]) => (count > 1 ? `${tool} ×${count}` : tool));
}

/**
 * The tools behind a reply, as one pill (06-chat-messages) that opens into the step-by-step
 * trace. While a tool is still running the pill says which, with a spinner.
 */
function ToolUse({
  activity,
  open,
  onToggle,
}: {
  activity: Activity[];
  open: boolean;
  onToggle: () => void;
}) {
  const running = activity.find((item) => item.status === "running");
  const failed = activity.some((item) => item.status === "error");
  const names = summarize(activity);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex max-w-full cursor-pointer items-center gap-2 self-start rounded-full bg-muted px-3 py-1.5 text-left text-body-s text-muted-foreground hover:text-foreground"
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : failed ? (
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0">
          {running ? (
            `${running.label}…`
          ) : (
            <>
              Used{" "}
              {names.map((name, index) => (
                <span key={name}>
                  {index > 0 && (index === names.length - 1 ? " and " : ", ")}
                  <span className="font-mono text-caption text-foreground">{name}</span>
                </span>
              ))}
            </>
          )}
        </span>
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <Trace className="ms-1">
          {activity.map((item) => {
            const Icon = TOOL_ICONS[item.tool] ?? Wrench;
            return (
              <TraceLine key={item.id} status={item.status === "done" ? undefined : item.status}>
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
    </div>
  );
}
