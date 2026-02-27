import { memo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Check, RotateCcw } from "lucide-react";
import MarkdownContent from "@/components/MarkdownContent";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  isLast?: boolean;
  onRetry?: () => void;
}

function ChatMessageInner({ role, content, isStreaming, isLast, onRetry }: ChatMessageProps) {
  const isUser = role === "user";
  const isThinking = isStreaming && !content;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <div
      className={cn(
        "flex gap-3 px-5 py-4",
        !isUser && "group relative bg-muted/30",
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

      {!isUser && content && !isStreaming && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5 text-muted-foreground" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy message"}</TooltipContent>
        </Tooltip>
      )}

      {!isUser && isLast && !isStreaming && onRetry && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={onRetry}
            >
              <RotateCcw className="size-3.5 text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Regenerate response</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

const ChatMessage = memo(ChatMessageInner);
export default ChatMessage;
