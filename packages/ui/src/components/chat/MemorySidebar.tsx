import { useMemo } from "react";
import { XIcon } from "lucide-react";
import type { UIMessage } from "@ai-sdk/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { InfoBubble } from "../InfoBubble";

interface MemorySidebarProps {
  messages: UIMessage[];
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
}

/**
 * Sidebar showing memories recalled by the agent during the current conversation.
 * Extracts memory_recall tool outputs from assistant messages.
 */
export function MemorySidebar({ messages, isOpen, onClose, isMobile }: MemorySidebarProps) {
  // Extract recalled memories from tool parts in chat messages
  const memories = useMemo(() => {
    return messages
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
  }, [messages]);

  if (!isOpen) return null;

  // Show overlay backdrop on mobile
  const showOverlay = isMobile && isOpen;

  return (
    <>
      {showOverlay && (
        <div
          className="fixed inset-0 z-[51] bg-black/60"
          onClick={onClose}
        />
      )}

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
              onClick={onClose}
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
    </>
  );
}

/** Helper to get the count of recalled memories from messages */
export function getMemoryCount(messages: UIMessage[]): number {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.parts ?? [])
    .filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) =>
        p.type === "tool-memory_recall" &&
        p.state === "output-available" &&
        p.output != null &&
        String(p.output).trim(),
    ).length;
}
