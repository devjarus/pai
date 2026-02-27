import { memo } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import MarkdownContent from "@/components/MarkdownContent";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

function ChatMessageInner({ role, content, isStreaming }: ChatMessageProps) {
  const isUser = role === "user";
  const isThinking = isStreaming && !content;

  return (
    <div
      className={cn(
        "flex gap-3 px-5 py-4",
        !isUser && "bg-muted/30",
      )}
    >
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarFallback
          className={cn(
            "text-xs font-semibold",
            isUser
              ? "bg-muted text-muted-foreground"
              : "bg-primary/15 text-primary",
          )}
        >
          {isUser ? "U" : "P"}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {isUser ? "You" : "pai"}
        </div>

        {isThinking ? (
          <div className="flex items-center gap-2 py-1">
            <Spinner className="size-3.5 text-primary/60" />
            <span className="text-xs text-muted-foreground">Thinking...</span>
          </div>
        ) : isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {content}
          </div>
        ) : (
          <div>
            <MarkdownContent content={content} />
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ChatMessage = memo(ChatMessageInner);
export default ChatMessage;
