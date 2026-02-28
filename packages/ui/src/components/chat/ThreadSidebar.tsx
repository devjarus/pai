import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";
import {
  useThreads,
  useDeleteThread,
  useRenameThread,
  useClearAllThreads,
} from "@/hooks/use-threads";
import type { Thread } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoBubble } from "../InfoBubble";

interface ThreadSidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onThreadDeleted: (threadId: string) => void;
  onAllThreadsCleared: () => void;
  isStreaming: boolean;
  isMobile: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export function ThreadSidebar({
  activeThreadId,
  onSelectThread,
  onNewThread,
  onThreadDeleted,
  onAllThreadsCleared,
  isStreaming,
  isMobile,
  isOpen,
  onToggle,
}: ThreadSidebarProps) {
  const { data: threads = [], isLoading: threadsLoading } = useThreads();
  const deleteThreadMut = useDeleteThread();
  const renameThreadMut = useRenameThread();
  const clearAllMut = useClearAllThreads();

  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingThreadId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingThreadId]);

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      try {
        await deleteThreadMut.mutateAsync(threadId);
        onThreadDeleted(threadId);
      } catch {
        toast.error("Failed to delete thread");
      }
    },
    [deleteThreadMut, onThreadDeleted],
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
      await renameThreadMut.mutateAsync({ id: renamingThreadId, title: renameValue.trim() });
    } catch {
      toast.error("Failed to rename thread");
    }
    setRenamingThreadId(null);
  }, [renamingThreadId, renameValue, renameThreadMut]);

  const handleCancelRename = useCallback(() => {
    setRenamingThreadId(null);
    setRenameValue("");
  }, []);

  const handleClearAllThreads = useCallback(async () => {
    if (!confirm("Delete all threads? This cannot be undone.")) return;
    try {
      const result = await clearAllMut.mutateAsync();
      onAllThreadsCleared();
      toast.success(`Cleared ${result.cleared} thread${result.cleared !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to clear threads");
    }
  }, [clearAllMut, onAllThreadsCleared]);

  const sidebarContent = (
    <>
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
                onClick={onNewThread}
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
                  if (renamingThreadId !== thread.id) onSelectThread(thread.id);
                }
              }}
              onClick={() => {
                if (renamingThreadId !== thread.id) {
                  onSelectThread(thread.id);
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
    </>
  );

  // Mobile: use Sheet drawer
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onToggle(); }}>
        <SheetContent side="left" showCloseButton={false} className="w-[80vw] max-w-72 gap-0 p-0">
          <SheetTitle className="sr-only">Threads</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: inline sidebar
  if (!isOpen) return null;

  return (
    <aside className="relative z-30 flex w-56 flex-col overflow-hidden border-r border-border bg-background">
      {sidebarContent}
    </aside>
  );
}
