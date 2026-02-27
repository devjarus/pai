import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { toast } from "sonner";
import {
  MoreHorizontalIcon,
  PlusIcon,
  SendIcon,
  BrainIcon,
  Trash2Icon,
  PencilIcon,
  CheckIcon,
  XIcon,
  PanelLeftIcon,
  PanelLeftCloseIcon,
  SquareIcon,
  ChevronDown,
} from "lucide-react";
import ChatMessage from "../components/ChatMessage";
import { renderToolPart } from "../components/tools";
import {
  getAgents,
  getChatHistory,
  clearChatHistory,
  getThreads,
  createThread,
  deleteThread,
  clearAllThreads,
  renameThread,
} from "../api";
import type { Agent, Thread } from "../types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { InfoBubble } from "../components/InfoBubble";

/** Tiny inline badge showing token usage for a message. */
function TokenBadge({ message }: { message: { metadata?: unknown } }) {
  // AI SDK v6 populates message.metadata from message-metadata stream chunks.
  // The metadata may contain usage info from the streamText finish event.
  const meta = message.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;

  // Try common locations for usage data
  const usage = (meta.usage ?? meta.totalUsage ?? meta) as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | undefined;

  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const totalTokens = usage?.totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0));

  if (!totalTokens || totalTokens === 0) return null;

  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60">
      {inputTokens != null && outputTokens != null
        ? `${inputTokens} in / ${outputTokens} out`
        : `${totalTokens} tokens`}
    </span>
  );
}

/** Detect if viewport is below md breakpoint */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [showMemories, setShowMemories] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [threadSidebarOpen, setThreadSidebarOpen] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const userAtBottomRef = useRef(true);
  const switchAbortRef = useRef<AbortController | null>(null);

  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  // Use a ref for activeThreadId so the transport body always has the latest value
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const selectedAgentRef = useRef(selectedAgent);
  selectedAgentRef.current = selectedAgent;

  const refreshThreads = useCallback(() => {
    getThreads().then(setThreads).catch(() => { /* non-critical */ });
  }, []);

  const applyServerThreadId = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    activeThreadIdRef.current = threadId;
    refreshThreads();
  }, [refreshThreads]);

  const applyServerThreadIdRef = useRef(applyServerThreadId);
  useEffect(() => {
    applyServerThreadIdRef.current = applyServerThreadId;
  }, [applyServerThreadId]);

  // Chat transport — uses refs via callback so body is always fresh
  // Only sends the last message since server loads history from SQLite
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          agent: selectedAgentRef.current,
          sessionId: activeThreadIdRef.current,
        }),
        fetch: async (input, init) => {
          // Send cookies for auth
          init = { ...init, credentials: "include" };
          const res = await globalThis.fetch(input, init);
          const newThreadId = res.headers.get("x-thread-id");
          if (newThreadId) {
            applyServerThreadIdRef.current(newThreadId);
          }
          return res;
        },
        prepareSendMessagesRequest: (opts) => ({
          body: {
            ...opts.body,
            id: opts.id,
            messages: opts.messages.slice(-1),
          },
        }),
      }),
    [],
  );

  const {
    messages: chatMessages,
    sendMessage,
    stop,
    status,
    error: chatError,
    setMessages: setChatMessages,
  } = useChat({
    transport: chatTransport,
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      // Humanize common LLM connection errors
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ECONNREFUSED")) {
        toast.error("Could not reach the AI provider. Check your LLM settings.");
      } else if (msg.includes("401") || msg.includes("API key")) {
        toast.error("Invalid API key. Check your LLM provider settings.");
      } else if (msg.includes("model") && msg.includes("not found")) {
        toast.error("Model not found. Check your model name in Settings.");
      } else if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
        toast.error("Request timed out. The AI provider may be slow or unreachable.");
      } else {
        toast.error(msg.length > 200 ? "Failed to get a response. Check Settings." : msg);
      }
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Memory sidebar: extract from tool-memory_recall parts in current messages
  // AI SDK v6 sends parts with type: "tool-memory_recall" and direct state/output fields
  const memories = useMemo(() => {
    return chatMessages
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts ?? [])
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) =>
          p.type === "tool-memory_recall" &&
          p.state === "output-available" &&
          p.output != null &&
          String(p.output).trim(),
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => String(p.output));
  }, [chatMessages]);

  const lastAssistantIdx = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].role === "assistant") return i;
    }
    return -1;
  }, [chatMessages]);

  const handleRetry = useCallback(() => {
    if (isStreaming || chatMessages.length === 0) return;
    const lastUserMsg = [...chatMessages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textParts = (lastUserMsg.parts ?? []).filter((p: any) => p.type === "text");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = textParts.map((p: any) => p.text).join("");
    if (!text) return;
    setChatMessages(chatMessages.filter((m) => m.id !== chatMessages[lastAssistantIdx]?.id));
    sendMessage({ parts: [{ type: "text", text }] });
  }, [isStreaming, chatMessages, lastAssistantIdx, setChatMessages, sendMessage]);

  useEffect(() => { document.title = "Chat - pai"; }, []);

  // On mobile, sidebars start closed
  useEffect(() => {
    if (isMobile) {
      setThreadSidebarOpen(false);
      setShowMemories(false);
    } else {
      setThreadSidebarOpen(true);
    }
  }, [isMobile]);

  // Load agents and threads on mount; handle ?thread=X&prompt=Y from inbox
  useEffect(() => {
    getAgents().then(setAgents).catch(() => toast.error("Failed to load agents"));
    setThreadsLoading(true);
    getThreads()
      .then((loaded) => {
        setThreads(loaded);
        // If navigated with ?thread=X, select that thread
        const threadParam = searchParams.get("thread");
        if (threadParam) {
          const found = loaded.find((t) => t.id === threadParam);
          if (found) {
            setActiveThreadId(found.id);
            activeThreadIdRef.current = found.id;
          }
          // Clear the query params so they don't persist on refresh
          setSearchParams({}, { replace: true });

          // Check sessionStorage for auto-send context (e.g. from Inbox "Start Chat")
          const autoSendRaw = sessionStorage.getItem("pai-chat-auto-send");
          if (autoSendRaw) {
            sessionStorage.removeItem("pai-chat-auto-send");
            try {
              const { threadId, message } = JSON.parse(autoSendRaw) as { threadId: string; message: string };
              if (threadId === threadParam && message) {
                // Small delay to let the chat transport initialize with the new thread
                setTimeout(() => {
                  sendMessage({ parts: [{ type: "text", text: message }] });
                }, 300);
              }
            } catch { /* ignore parse errors */ }
          }
        }
      })
      .catch(() => toast.error("Failed to load threads"))
      .finally(() => setThreadsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh threads when streaming finishes
  useEffect(() => {
    if (status === "ready" && activeThreadId) {
      getThreads().then(setThreads).catch(() => { /* non-critical refresh */ });
    }
  }, [status, activeThreadId]);

  // Track if user is scrolled to bottom (RAF-debounced to avoid excessive events)
  const scrollRafRef = useRef<number>(0);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return; // already scheduled
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const threshold = 80;
      userAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setShowScrollButton(!userAtBottomRef.current);
    });
  }, []);

  // Auto-scroll on new messages only if user is at bottom
  useEffect(() => {
    if (!userAtBottomRef.current) return;
    setShowScrollButton(false);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    });
  }, [chatMessages]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingThreadId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingThreadId]);

  // Load messages when switching threads
  const switchThread = useCallback(
    async (threadId: string) => {
      if (threadId === activeThreadId || isStreaming) return;
      // Abort any in-flight thread switch
      switchAbortRef.current?.abort();
      const controller = new AbortController();
      switchAbortRef.current = controller;

      // Clear messages immediately so user doesn't see stale chat from previous thread
      setChatMessages([]);
      setThreadLoading(true);
      setActiveThreadId(threadId);
      activeThreadIdRef.current = threadId;
      // Close thread sidebar on mobile after selecting
      if (isMobile) setThreadSidebarOpen(false);
      try {
        const history = await getChatHistory(threadId);
        // Guard against aborted/stale response
        if (controller.signal.aborted) return;
        setChatMessages(
          history.map((m, i) => ({
            id: `hist-${i}`,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: m.content }],
            createdAt: new Date(),
          })),
        );
      } catch {
        // Retry once — transient network errors are the most common cause
        if (controller.signal.aborted) return;
        try {
          const history = await getChatHistory(threadId);
          if (controller.signal.aborted) return;
          setChatMessages(
            history.map((m, i) => ({
              id: `hist-${i}`,
              role: m.role as "user" | "assistant",
              parts: [{ type: "text" as const, text: m.content }],
              createdAt: new Date(),
            })),
          );
        } catch {
          if (!controller.signal.aborted) setChatMessages([]);
        }
      } finally {
        if (!controller.signal.aborted) setThreadLoading(false);
      }
    },
    [activeThreadId, isStreaming, isMobile, setChatMessages],
  );

  const handleNewThread = useCallback(async () => {
    if (isStreaming) return;
    const thread = await createThread(undefined, selectedAgent);
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
    activeThreadIdRef.current = thread.id;
    setChatMessages([]);
    if (isMobile) setThreadSidebarOpen(false);
    inputRef.current?.focus();
  }, [isStreaming, selectedAgent, isMobile, setChatMessages]);

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      try {
        await deleteThread(threadId);
      } catch {
        toast.error("Failed to delete thread");
        return;
      }
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        activeThreadIdRef.current = null;
        setChatMessages([]);
      }
    },
    [activeThreadId, setChatMessages],
  );

  const handleStartRename = useCallback((thread: Thread) => {
    setRenamingThreadId(thread.id);
    setRenameValue(thread.title);
  }, []);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingThreadId || !renameValue.trim()) {
      setRenamingThreadId(null);
      return;
    }
    try {
      const updated = await renameThread(renamingThreadId, renameValue.trim());
      setThreads((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t)),
      );
    } catch {
      toast.error("Failed to rename thread");
    }
    setRenamingThreadId(null);
  }, [renamingThreadId, renameValue]);

  const handleCancelRename = useCallback(() => {
    setRenamingThreadId(null);
    setRenameValue("");
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    sendMessage({ parts: [{ type: "text", text }] });
  }, [input, isStreaming, sendMessage]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleClear = useCallback(() => {
    if (!activeThreadId) return;
    if (!confirm("Clear all messages in this thread?")) return;
    clearChatHistory(activeThreadId).catch(() => {});
    setChatMessages([]);
    refreshThreads();
  }, [activeThreadId, refreshThreads, setChatMessages]);

  const handleClearAllThreads = useCallback(async () => {
    if (!confirm("Delete all threads? This cannot be undone.")) return;
    try {
      const result = await clearAllThreads();
      setThreads([]);
      setActiveThreadId(null);
      activeThreadIdRef.current = null;
      setChatMessages([]);
      toast.success(`Cleared ${result.cleared} thread${result.cleared !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to clear threads");
    }
  }, [setChatMessages]);

  const handleScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    setShowScrollButton(false);
  }, []);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  // Show sidebar overlay backdrop on mobile
  const showThreadOverlay = isMobile && threadSidebarOpen;
  const showMemoryOverlay = isMobile && showMemories;

  return (
    <div className="relative flex h-full">
      {/* Thread sidebar backdrop (mobile) */}
      {showThreadOverlay && (
        <div
          className="fixed inset-0 z-[51] bg-black/60"
          onClick={() => setThreadSidebarOpen(false)}
        />
      )}

      {/* Thread sidebar */}
      <aside
        className={cn(
          "flex flex-col overflow-hidden border-r border-border bg-background transition-transform duration-200",
          isMobile
            ? "fixed inset-y-0 left-0 z-[52] w-[80vw] max-w-72"
            : "relative z-30 w-56",
          isMobile && !threadSidebarOpen && "-translate-x-full",
          !isMobile && !threadSidebarOpen && "hidden",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3 pl-4">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="shrink-0">Threads</span>
            <InfoBubble text="Each thread is a separate conversation. Your chat history is preserved when you switch between threads." side="right" />
          </span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleClearAllThreads}
                  disabled={isStreaming || threads.length === 0}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Clear all threads</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={handleNewThread}
                  disabled={isStreaming}
                >
                  <PlusIcon className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New thread</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Separator />

        <div className="flex-1 overflow-y-auto">
          {threadsLoading && (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-2.5 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {!threadsLoading && threads.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No conversations yet. Send a message to start.
            </p>
          )}

          {!threadsLoading &&
            threads.map((thread) => (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (renamingThreadId !== thread.id) switchThread(thread.id);
                  }
                }}
                onClick={() => {
                  if (renamingThreadId !== thread.id) {
                    switchThread(thread.id);
                  }
                }}
                className={cn(
                  "group flex cursor-pointer items-center justify-between border-b border-border/50 px-3 py-2.5 transition-colors",
                  thread.id === activeThreadId
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <div className="min-w-0 flex-1">
                  {renamingThreadId === thread.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleConfirmRename();
                          }
                          if (e.key === "Escape") {
                            handleCancelRename();
                          }
                        }}
                        onBlur={handleConfirmRename}
                        className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs text-foreground outline-none"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmRename();
                        }}
                      >
                        <CheckIcon className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelRename();
                        }}
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="truncate text-xs font-medium">
                        {thread.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                        {thread.messageCount > 0 && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1 text-[9px]"
                          >
                            {thread.messageCount}
                          </Badge>
                        )}
                        <span>
                          {new Date(thread.updatedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {renamingThreadId !== thread.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="ml-1 shrink-0 text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartRename(thread);
                        }}
                      >
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteThread(thread.id);
                        }}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border bg-background px-3 py-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            {/* Thread sidebar toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setThreadSidebarOpen((v) => !v)}
                  aria-label={threadSidebarOpen ? "Hide threads" : "Show threads"}
                >
                  {threadSidebarOpen ? (
                    <PanelLeftCloseIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <PanelLeftIcon className="size-4 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {threadSidebarOpen ? "Hide threads" : "Show threads"}
              </TooltipContent>
            </Tooltip>

            <h1 className="truncate font-mono text-sm font-medium text-foreground">
              {activeThread?.title ?? "Chat"}
            </h1>
            {agents.length > 1 && (
              <select
                value={selectedAgent ?? ""}
                onChange={(e) =>
                  setSelectedAgent(e.target.value || undefined)
                }
                className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground outline-none transition-colors focus:border-primary/50"
              >
                <option value="">Default Agent</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.displayName ?? a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showMemories ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowMemories((v) => !v)}
                  className={cn(
                    showMemories && "bg-primary/15 text-primary hover:bg-primary/20",
                  )}
                >
                  <BrainIcon className="size-3.5" />
                  <span className="hidden text-xs md:inline">
                    Memories
                    {memories.length > 0 && ` (${memories.length})`}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle memory sidebar</TooltipContent>
            </Tooltip>

            {activeThreadId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleClear}
                  >
                    <Trash2Icon className="size-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear messages</TooltipContent>
              </Tooltip>
            )}
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto scroll-smooth">
          {threadLoading && chatMessages.length === 0 ? (
            <div className="flex flex-col">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-3 px-5 py-4",
                    i % 2 === 1 && "bg-muted/30",
                  )}
                >
                  <Skeleton className="mt-0.5 size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="mb-2 h-3 w-12" />
                    <Skeleton className={cn("h-4", i % 2 === 0 ? "w-2/3" : "w-full")} />
                    {i % 2 === 1 && <Skeleton className="mt-1.5 h-4 w-4/5" />}
                  </div>
                </div>
              ))}
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-4">
              <div className="mb-3 font-mono text-5xl font-bold tracking-tighter text-muted-foreground/30">
                pai
              </div>
              <p className="text-center text-sm text-muted-foreground">
                {activeThreadId
                  ? "This thread is empty. Send a message to start."
                  : "Start a conversation or select a thread."}
              </p>
            </div>
          ) : null}
          {chatMessages.map((message, msgIdx) => {
            // Separate text parts and tool parts
            const parts = message.parts ?? [];
            const textContent = parts
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .filter((p: any) => p.type === "text")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((p: any) => p.text)
              .join("");

            // AI SDK v6: tool parts have type "tool-${toolName}" (e.g. "tool-memory_recall")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolParts = parts.filter((p: any) =>
              typeof p.type === "string" && p.type.startsWith("tool-") && p.type !== "tool-invocation",
            );

            const isLastAssistant =
              isStreaming &&
              msgIdx === chatMessages.length - 1 &&
              message.role === "assistant";

            const isLastAssistantMsg =
              message.role === "assistant" &&
              msgIdx === lastAssistantIdx;

            return (
              <div key={message.id}>
                {message.role === "assistant" &&
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  toolParts.map((part: any, i: number) => (
                    <div key={`${message.id}-tool-${i}`} className="mx-auto max-w-3xl px-4 md:px-6">
                      {renderToolPart(part, `${message.id}-tool-${i}`)}
                    </div>
                  ))}
                {(textContent || isLastAssistant) && (
                  <ChatMessage
                    role={message.role as "user" | "assistant"}
                    content={textContent}
                    isStreaming={isLastAssistant}
                    isLast={isLastAssistantMsg && !isStreaming}
                    onRetry={isLastAssistantMsg && !isStreaming ? handleRetry : undefined}
                  />
                )}
                {message.role === "assistant" && !isLastAssistant && (
                  <div className="mx-auto max-w-3xl px-5">
                    <TokenBadge message={message} />
                  </div>
                )}
              </div>
            );
          })}
          {status === "submitted" && (chatMessages.length === 0 || chatMessages[chatMessages.length - 1].role !== "assistant") && (
            <ChatMessage role="assistant" content="" isStreaming />
          )}
          {chatError && status !== "streaming" && status !== "submitted" && (
            <div className="mx-auto max-w-3xl px-5 py-2">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Failed to get a response. Check your LLM provider settings or try again.
              </div>
            </div>
          )}

          {showScrollButton && chatMessages.length > 0 && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-lg"
              onClick={handleScrollToBottom}
            >
              <ChevronDown className="size-4" />
            </Button>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-background px-3 py-3 md:px-4 md:py-4">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isMobile ? "Type a message..." : "Type a message... (Enter to send, Shift+Enter for newline)"}
              rows={1}
              className="min-h-10 max-h-36 flex-1 resize-none"
              disabled={isStreaming}
            />
            {isStreaming ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleStop}
                    variant="destructive"
                    size="icon"
                  >
                    <SquareIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop generating</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    size="icon"
                  >
                    <SendIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Send message</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* Memory sidebar backdrop (mobile) */}
      {showMemoryOverlay && (
        <div
          className="fixed inset-0 z-[51] bg-black/60"
          onClick={() => setShowMemories(false)}
        />
      )}

      {/* Memory sidebar */}
      {showMemories && (
        <aside
          className={cn(
            "flex flex-col border-l border-border bg-background",
            isMobile ? "fixed inset-y-0 right-0 z-[52] w-[85vw] max-w-80" : "relative z-30 w-72",
          )}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="shrink-0">Recalled Memories</span>
              <InfoBubble text="Memories the agent recalled to answer your message. These come from beliefs stored in pai's memory system." side="left" />
            </h2>
            {isMobile && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowMemories(false)}
                aria-label="Close memories"
              >
                <XIcon className="size-3.5 text-muted-foreground" />
              </Button>
            )}
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            <div className="p-3">
              {memories.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  No memories recalled yet. Memories will appear here when the
                  agent retrieves context for your messages.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {memories.map((mem, i) => (
                    <Card
                      key={`mem-${i}-${mem.slice(0, 32)}`}
                      className="gap-0 rounded-lg border-border/50 py-0 shadow-none"
                    >
                      <CardContent className="px-3 py-2.5">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {mem}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
      )}
    </div>
  );
}
