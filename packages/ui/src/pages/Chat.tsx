import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getChatHistory, clearChatHistory, createThread } from "../api";
import type { ChatHistoryMessage, Thread } from "../types";
import { useCreateProgram, usePrograms } from "@/hooks";
import { useThreads, threadKeys } from "@/hooks/use-threads";
import { useIsMobile } from "@/hooks/use-mobile";

import { ChatRuntimeProvider, useChatRuntimeHandle } from "@/components/chat/ChatRuntimeProvider";
import { AllToolUIs } from "@/components/chat/tool-uis";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { MemorySidebar, getMemoryCount } from "@/components/chat/MemorySidebar";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Thread as AssistantThread } from "@/components/assistant-ui/thread";
import { buildThreadProgramDraft } from "@/lib/program-drafts";

function messageToHistoryEntry(
  message: { role: string; parts?: Array<{ type?: string; text?: string }> },
): ChatHistoryMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const content = (message.parts ?? [])
    .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
    .join("\n")
    .trim();
  if (!content) return null;
  return {
    role: message.role,
    content,
  };
}

export default function Chat() {
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [showMemories, setShowMemories] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadSidebarOpen, setThreadSidebarOpen] = useState(true);

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { data: threads = [] } = useThreads();

  useEffect(() => { document.title = "Ask - pai"; }, []);

  // On mobile, sidebars start closed
  useEffect(() => {
    if (isMobile) {
      setThreadSidebarOpen(false);
      setShowMemories(false);
    } else {
      setThreadSidebarOpen(true);
    }
  }, [isMobile]);

  const onThreadCreated = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    activeThreadIdRef.current = threadId;
  }, []);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  return (
    <ChatRuntimeProvider
      activeThreadId={activeThreadId}
      selectedAgent={selectedAgent}
      onThreadCreated={onThreadCreated}
    >
      <AllToolUIs />
      <ChatInner
        activeThreadId={activeThreadId}
        setActiveThreadId={setActiveThreadId}
        activeThreadIdRef={activeThreadIdRef}
        activeThread={activeThread}
        threads={threads}
        selectedAgent={selectedAgent}
        setSelectedAgent={setSelectedAgent}
        showMemories={showMemories}
        setShowMemories={setShowMemories}
        threadSidebarOpen={threadSidebarOpen}
        setThreadSidebarOpen={setThreadSidebarOpen}
        isMobile={isMobile}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        queryClient={queryClient}
      />
    </ChatRuntimeProvider>
  );
}

/**
 * Inner component that has access to the ChatRuntimeHandle via context.
 * Must be rendered inside ChatRuntimeProvider.
 */
function ChatInner({
  activeThreadId,
  setActiveThreadId,
  activeThreadIdRef,
  activeThread,
  threads,
  selectedAgent,
  setSelectedAgent,
  showMemories,
  setShowMemories,
  threadSidebarOpen,
  setThreadSidebarOpen,
  isMobile,
  searchParams,
  setSearchParams,
  queryClient,
}: {
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  activeThread: Thread | undefined;
  threads: Thread[];
  selectedAgent: string | undefined;
  setSelectedAgent: (agent: string | undefined) => void;
  showMemories: boolean;
  setShowMemories: (show: boolean) => void;
  threadSidebarOpen: boolean;
  setThreadSidebarOpen: (open: boolean) => void;
  isMobile: boolean;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const handleRef = useChatRuntimeHandle();
  const switchAbortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);
  const createProgram = useCreateProgram();
  const { data: programs = [] } = usePrograms();

  const isStreaming = handleRef.current?.status === "streaming" || handleRef.current?.status === "submitted";

  // Load thread from URL params on mount (inbox auto-send flow)
  useEffect(() => {
    if (initializedRef.current) return;

    const threadParam = searchParams.get("thread");
    if (!threadParam) {
      // No thread param — mark initialized so we don't re-run
      initializedRef.current = true;
      return;
    }

    // When navigating from Inbox "Start Chat", the newly created thread may
    // not be in the cached list yet. Activate it directly by ID — don't
    // require it to be in the threads array.
    initializedRef.current = true;
    setActiveThreadId(threadParam);
    activeThreadIdRef.current = threadParam;

    // Refresh thread list so the sidebar picks up the new thread
    queryClient.invalidateQueries({ queryKey: threadKeys.all });

    // Load chat history for the selected thread
    getChatHistory(threadParam).then((history) => {
      handleRef.current?.setChatMessages(
        history.map((m, i) => ({
          id: `hist-${threadParam}-${i}`,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: m.content }],
          createdAt: new Date(),
        })),
      );
      requestAnimationFrame(() => {
        const viewport = document.querySelector(".aui-thread-viewport");
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    }).catch(() => {
      handleRef.current?.setChatMessages([]);
    });

    // Clear the query params so they don't persist on refresh
    setSearchParams({}, { replace: true });

    // Check sessionStorage for auto-send context (e.g. from Inbox "Start Chat")
    const autoSendRaw = sessionStorage.getItem("pai-chat-auto-send");
    if (autoSendRaw) {
      sessionStorage.removeItem("pai-chat-auto-send");
      try {
        const { threadId, message } = JSON.parse(autoSendRaw) as { threadId: string; message: string };
        if (threadId === threadParam && message) {
          setTimeout(() => {
            handleRef.current?.sendMessage({ parts: [{ type: "text", text: message }] });
          }, 300);
        }
      } catch { /* ignore parse errors */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount — no dependency on threads list

  // Load messages when switching threads
  const switchThread = useCallback(
    async (threadId: string) => {
      if (threadId === activeThreadId || isStreaming) return;
      // Abort any in-flight thread switch
      switchAbortRef.current?.abort();
      const controller = new AbortController();
      switchAbortRef.current = controller;

      // Switch thread ID immediately but don't clear messages yet
      // (avoids a blank flash while history loads)
      setActiveThreadId(threadId);
      activeThreadIdRef.current = threadId;
      // Close thread sidebar on mobile after selecting
      if (isMobile) setThreadSidebarOpen(false);

      const mapHistory = (history: { role: string; content: string }[]) =>
        history.map((m, i) => ({
          id: `hist-${threadId}-${i}`,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: m.content }],
          createdAt: new Date(),
        }));

      try {
        const history = await getChatHistory(threadId);
        if (controller.signal.aborted) return;
        // Clear then immediately set — triggers assistant-ui scroll reset
        // without a visible blank flash (same JS tick)
        handleRef.current?.setChatMessages([]);
        handleRef.current?.setChatMessages(mapHistory(history));
        // Scroll to bottom after messages render
        requestAnimationFrame(() => {
          const viewport = document.querySelector(".aui-thread-viewport");
          if (viewport) viewport.scrollTop = viewport.scrollHeight;
        });
      } catch {
        if (!controller.signal.aborted) handleRef.current?.setChatMessages([]);
      }
    },
    [activeThreadId, isStreaming, isMobile, setActiveThreadId, activeThreadIdRef, setThreadSidebarOpen, handleRef],
  );

  const handleNewThread = useCallback(async () => {
    if (isStreaming) return;
    const thread = await createThread(undefined, selectedAgent);
    queryClient.invalidateQueries({ queryKey: threadKeys.all });
    setActiveThreadId(thread.id);
    activeThreadIdRef.current = thread.id;
    handleRef.current?.setChatMessages([]);
    if (isMobile) setThreadSidebarOpen(false);
  }, [isStreaming, selectedAgent, isMobile, setActiveThreadId, activeThreadIdRef, setThreadSidebarOpen, queryClient, handleRef]);

  // Listen for branch events from assistant message action bar
  useEffect(() => {
    const handler = async (e: Event) => {
      const { messageId, sequence } = (e as CustomEvent).detail;
      if (!activeThreadId) return;
      const title = activeThread ? `Branch of ${activeThread.title}` : "New branch";
      const thread = await createThread(title, selectedAgent, activeThreadId, messageId, sequence);
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
      // Load the branched thread with its copied messages
      const history = await getChatHistory(thread.id);
      const mapHistory = (h: { role: string; content: string }[]) =>
        h.map((m, i) => ({ id: `hist-${thread.id}-${i}`, role: m.role as "user" | "assistant", parts: [{ type: "text" as const, text: m.content }], createdAt: new Date() }));
      setActiveThreadId(thread.id);
      activeThreadIdRef.current = thread.id;
      handleRef.current?.setChatMessages([]);
      handleRef.current?.setChatMessages(mapHistory(history));
    };
    window.addEventListener("pai:branch-thread", handler);
    return () => window.removeEventListener("pai:branch-thread", handler);
  }, [activeThreadId, activeThread, selectedAgent, setActiveThreadId, activeThreadIdRef, queryClient, handleRef]);

  const handleThreadDeleted = useCallback(
    (threadId: string) => {
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        activeThreadIdRef.current = null;
        handleRef.current?.setChatMessages([]);
      }
    },
    [activeThreadId, setActiveThreadId, activeThreadIdRef, handleRef],
  );

  const handleAllThreadsCleared = useCallback(() => {
    setActiveThreadId(null);
    activeThreadIdRef.current = null;
    handleRef.current?.setChatMessages([]);
  }, [setActiveThreadId, activeThreadIdRef, handleRef]);

  const handleClear = useCallback(() => {
    if (!activeThreadId) return;
    if (!confirm("Clear all messages in this thread?")) return;
    clearChatHistory(activeThreadId).catch(() => {});
    handleRef.current?.setChatMessages([]);
    queryClient.invalidateQueries({ queryKey: threadKeys.all });
  }, [activeThreadId, queryClient, handleRef]);

  const messages = handleRef.current?.messages ?? [];
  const memoryCount = getMemoryCount(messages);
  const linkedProgram = activeThreadId
    ? programs.find((program) => program.threadId === activeThreadId)
    : undefined;
  const canKeepWatching = Boolean(
    activeThreadId &&
    !isStreaming &&
    !linkedProgram &&
    messages.some((message) => message.role === "user"),
  );

  const handleKeepWatching = useCallback(async () => {
    if (!activeThreadId || createProgram.isPending || linkedProgram) return;
    try {
      const persistedHistory = await getChatHistory(activeThreadId);
      const runtimeHistory = messages
        .map((message) =>
          messageToHistoryEntry(message as { role: string; parts?: Array<{ type?: string; text?: string }> }),
        )
        .filter((message): message is ChatHistoryMessage => Boolean(message));
      const history = persistedHistory.some((message) => message.role === "user" && message.content.trim().length > 0)
        ? persistedHistory
        : runtimeHistory;
      const hasUserMessage = history.some((message) => message.role === "user" && message.content.trim().length > 0);
      if (!hasUserMessage) {
        toast.error("Start with a question before turning this into a Program.");
        return;
      }

      const draft = buildThreadProgramDraft({
        threadId: activeThreadId,
        threadTitle: activeThread?.title,
        history,
      });
      await createProgram.mutateAsync(draft);
      toast.success("Program created. pai will keep watching this thread.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create program");
    }
  }, [activeThread?.title, activeThreadId, createProgram, linkedProgram, messages]);

  return (
    <div className="relative flex h-full">
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onSelectThread={switchThread}
        onNewThread={handleNewThread}
        onBranchThread={async (parentId) => {
          const parent = threads?.find(t => t.id === parentId);
          const title = parent ? `Branch of ${parent.title}` : "New branch";
          const thread = await createThread(title, selectedAgent, parentId);
          queryClient.invalidateQueries({ queryKey: threadKeys.all });
          // Load copied messages into the UI
          const history = await getChatHistory(thread.id);
          const mapped = history.map((m: { role: string; content: string }, i: number) => ({
            id: `hist-${thread.id}-${i}`, role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: m.content }], createdAt: new Date(),
          }));
          setActiveThreadId(thread.id);
          activeThreadIdRef.current = thread.id;
          handleRef.current?.setChatMessages([]);
          handleRef.current?.setChatMessages(mapped);
        }}
        onThreadDeleted={handleThreadDeleted}
        onAllThreadsCleared={handleAllThreadsCleared}
        isStreaming={isStreaming ?? false}
        isMobile={isMobile}
        isOpen={threadSidebarOpen}
        onToggle={() => setThreadSidebarOpen(!threadSidebarOpen)}
      />

      {/* Main chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader
          activeThread={activeThread}
          activeThreadId={activeThreadId}
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          threadSidebarOpen={threadSidebarOpen}
          onToggleThreadSidebar={() => setThreadSidebarOpen(!threadSidebarOpen)}
          showMemories={showMemories}
          onToggleMemories={() => setShowMemories(!showMemories)}
          memoryCount={memoryCount}
          canKeepWatching={canKeepWatching}
          keepWatchingPending={createProgram.isPending}
          keepWatchingLabel={linkedProgram ? "Watching" : "Keep watching"}
          keepWatchingTooltip={linkedProgram ? "This thread already has a Program" : "Turn this thread into a Program"}
          onKeepWatching={handleKeepWatching}
          onClear={handleClear}
          onSelectThread={switchThread}
        />

        {/* assistant-ui Thread handles messages, composer, auto-scroll, tool rendering */}
        <AssistantThread />
      </div>

      <MemorySidebar
        messages={messages}
        isOpen={showMemories}
        onClose={() => setShowMemories(false)}
        isMobile={isMobile}
      />
    </div>
  );
}
