import { type ReactNode, useMemo, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
} from "@assistant-ui/react";
import type { AttachmentAdapter } from "@assistant-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { threadKeys } from "@/hooks/use-threads";
import { programKeys } from "@/hooks/use-programs";
import { taskKeys } from "@/hooks/use-tasks";
import { inboxKeys } from "@/hooks/use-inbox";
import { beliefKeys } from "@/hooks/use-beliefs";

/**
 * Attachment adapter for binary documents (PDF, Excel).
 * Reads the file as a base64 data URL and sends it as a file part,
 * which the server decodes and parses via document-parser.
 */
class BinaryDocumentAttachmentAdapter implements AttachmentAdapter {
  accept =
    "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.ms-excel,.xls";

  async add(state: { file: File }) {
    return {
      id: state.file.name,
      type: "document" as const,
      name: state.file.name,
      contentType: state.file.type,
      file: state.file,
      status: { type: "requires-action" as const, reason: "composer-send" as const },
    };
  }

  async send(attachment: { id: string; type: string; file: File; name: string; contentType?: string }) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(attachment.file);
    });

    return {
      ...attachment,
      status: { type: "complete" as const },
      content: [
        {
          type: "file" as const,
          data: dataUrl,
          mimeType: attachment.contentType || attachment.file.type,
          filename: attachment.name,
        },
      ],
    };
  }

  async remove() {
    // noop
  }
}

interface ChatRuntimeProviderProps {
  activeThreadId: string | null;
  selectedAgent: string | undefined;
  onThreadCreated: (threadId: string) => void;
  children: ReactNode;
}

/**
 * Bridges AI SDK's useChat with assistant-ui's runtime system.
 *
 * Preserves the existing DefaultChatTransport with auth cookies,
 * x-thread-id header interception, and single-message sends.
 * Exposes setChatMessages and chat helpers via a ref-based context.
 */
export interface ChatRuntimeHandle {
  setChatMessages: ReturnType<typeof useChat>["setMessages"];
  sendMessage: ReturnType<typeof useChat>["sendMessage"];
  messages: ReturnType<typeof useChat>["messages"];
  status: ReturnType<typeof useChat>["status"];
  stop: ReturnType<typeof useChat>["stop"];
}

// Simple ref-based handle so parent can interact with the chat
import { createContext, useContext } from "react";
const ChatRuntimeHandleContext = createContext<React.RefObject<ChatRuntimeHandle | null>>({ current: null });
export function useChatRuntimeHandle() {
  return useContext(ChatRuntimeHandleContext);
}

export function ChatRuntimeProvider({
  activeThreadId,
  selectedAgent,
  onThreadCreated,
  children,
}: ChatRuntimeProviderProps) {
  const queryClient = useQueryClient();

  // Use refs so the transport body callback always reads fresh values
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const selectedAgentRef = useRef(selectedAgent);
  selectedAgentRef.current = selectedAgent;

  const onThreadCreatedRef = useRef(onThreadCreated);
  useEffect(() => {
    onThreadCreatedRef.current = onThreadCreated;
  }, [onThreadCreated]);

  // Chat transport — same setup as the original Chat.tsx
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
          let res = await globalThis.fetch(input, init);

          // Auto-refresh token on 401 and retry once (mirrors api.ts logic)
          if (res.status === 401) {
            try {
              const refreshRes = await globalThis.fetch("/api/auth/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
                credentials: "include",
              });
              if (refreshRes.ok) {
                res = await globalThis.fetch(input, init);
              }
            } catch { /* refresh failed, return original 401 */ }
          }

          const newThreadId = res.headers.get("x-thread-id");
          if (newThreadId) {
            onThreadCreatedRef.current(newThreadId);
            queryClient.invalidateQueries({ queryKey: threadKeys.all });
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
    [queryClient],
  );

  const chatHelpers = useChat({
    transport: chatTransport,
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
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

  const attachmentAdapter = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
        new BinaryDocumentAttachmentAdapter(),
      ]),
    [],
  );

  const runtime = useAISDKRuntime(chatHelpers, {
    adapters: { attachments: attachmentAdapter },
  });

  // Expose handle for external components (thread switching, memory sidebar, etc.)
  const handleRef = useRef<ChatRuntimeHandle | null>(null);
  handleRef.current = {
    setChatMessages: chatHelpers.setMessages,
    sendMessage: chatHelpers.sendMessage,
    messages: chatHelpers.messages,
    status: chatHelpers.status,
    stop: chatHelpers.stop,
  };

  // Refresh threads and loop surfaces when streaming finishes — two waves:
  // 1. 500ms: pick up immediate message count / autoTitle changes
  // 2. 2500ms: pick up LLM-generated title (generateThreadTitle runs in onFinish
  //    which executes after the stream closes and can take 1-3s for the LLM call)
  const prevStatusRef = useRef(chatHelpers.status);
  useEffect(() => {
    const refreshLoopSurfaces = () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.all });
      queryClient.invalidateQueries({ queryKey: programKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: inboxKeys.all });
      queryClient.invalidateQueries({ queryKey: beliefKeys.all });
    };

    const prev = prevStatusRef.current;
    prevStatusRef.current = chatHelpers.status;
    if (chatHelpers.status === "ready" && (prev === "streaming" || prev === "submitted") && activeThreadIdRef.current) {
      const t1 = setTimeout(() => {
        refreshLoopSurfaces();
      }, 500);
      const t2 = setTimeout(() => {
        refreshLoopSurfaces();
      }, 2500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [chatHelpers.status, queryClient]);

  return (
    <ChatRuntimeHandleContext.Provider value={handleRef}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ChatRuntimeHandleContext.Provider>
  );
}
