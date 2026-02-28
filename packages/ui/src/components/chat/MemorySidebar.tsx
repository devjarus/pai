import { useMemo } from "react";
import type { UIMessage } from "@ai-sdk/react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
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

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="shrink-0">Recalled Memories</span>
          <InfoBubble text="Memories the agent recalled to answer your message. These come from beliefs stored in pai's memory system." side="left" />
        </h2>
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
    </>
  );

  if (!isOpen) return null;

  // Mobile: use Sheet drawer
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent side="right" showCloseButton className={cn("w-[85vw] max-w-80 gap-0 p-0")}>
          <SheetTitle className="sr-only">Recalled Memories</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: inline sidebar
  return (
    <aside className="relative z-30 flex w-72 flex-col border-l border-border bg-background">
      {sidebarContent}
    </aside>
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
