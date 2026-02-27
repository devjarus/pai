import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getChatHistory, clearChatHistory, createThread } from "../api";
import type { Thread } from "../types";
import { useThreads, threadKeys } from "@/hooks/use-threads";

import { ChatRuntimeProvider, useChatRuntimeHandle } from "@/components/chat/ChatRuntimeProvider";
import { AllToolUIs } from "@/components/chat/tool-uis";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { MemorySidebar, getMemoryCount } from "@/components/chat/MemorySidebar";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Thread as AssistantThread } from "@/components/assistant-ui/thread";

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
        selectedAgent={selectedAgent}
        setSelectedAgent={setSelectedAgent}
        showMemories={showMemories}
        setShowMemories={setShowMemories}
        threadSidebarOpen={threadSidebarOpen}
        setThreadSidebarOpen={setThreadSidebarOpen}
        isMobile={isMobile}
        threads={threads}
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
  selectedAgent,
  setSelectedAgent,
  showMemories,
  setShowMemories,
  threadSidebarOpen,
  setThreadSidebarOpen,
  isMobile,
  threads,
  searchParams,
  setSearchParams,
  queryClient,
}: {
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  activeThread: Thread | undefined;
  selectedAgent: string | undefined;
  setSelectedAgent: (agent: string | undefined) => void;
  showMemories: boolean;
  setShowMemories: (show: boolean) => void;
  threadSidebarOpen: boolean;
  setThreadSidebarOpen: (open: boolean) => void;
  isMobile: boolean;
  threads: Thread[];
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const handleRef = useChatRuntimeHandle();
  const switchAbortRef = useRef<AbortController | null>(null);
  const initializedRef = useRef(false);

  const isStreaming = handleRef.current?.status === "streaming" || handleRef.current?.status === "submitted";

  // Load thread from URL params on mount (inbox auto-send flow)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const threadParam = searchParams.get("thread");
    if (threadParam) {
      const found = threads.find((t) => t.id === threadParam);
      if (found) {
        setActiveThreadId(found.id);
        activeThreadIdRef.current = found.id;

        // Load chat history for the selected thread
        getChatHistory(found.id).then((history) => {
          handleRef.current?.setChatMessages(
            history.map((m, i) => ({
              id: `hist-${found.id}-${i}`,
              role: m.role as "user" | "assistant",
              parts: [{ type: "text" as const, text: m.content }],
              createdAt: new Date(),
            })),
          );
        }).catch(() => {
          handleRef.current?.setChatMessages([]);
        });
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
            setTimeout(() => {
              handleRef.current?.sendMessage({ parts: [{ type: "text", text: message }] });
            }, 300);
          }
        } catch { /* ignore parse errors */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.length > 0]); // Wait for threads to load

  // Load messages when switching threads
  const switchThread = useCallback(
    async (threadId: string) => {
      if (threadId === activeThreadId || isStreaming) return;
      // Abort any in-flight thread switch
      switchAbortRef.current?.abort();
      const controller = new AbortController();
      switchAbortRef.current = controller;

      // Clear messages and switch
      handleRef.current?.setChatMessages([]);
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
        handleRef.current?.setChatMessages(mapHistory(history));
      } catch {
        if (controller.signal.aborted) return;
        try {
          const history = await getChatHistory(threadId);
          if (controller.signal.aborted) return;
          handleRef.current?.setChatMessages(mapHistory(history));
        } catch {
          if (!controller.signal.aborted) handleRef.current?.setChatMessages([]);
        }
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

  return (
    <div className="relative flex h-full">
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onSelectThread={switchThread}
        onNewThread={handleNewThread}
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
          onClear={handleClear}
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
