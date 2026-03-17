import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  CheckIcon,
  XIcon,
  ChevronRightIcon,
  GitBranchIcon,
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
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";
import { useAppTimezone } from "@/hooks";

interface ThreadSidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onBranchThread: (parentId: string) => void;
  onThreadDeleted: (threadId: string) => void;
  onAllThreadsCleared: () => void;
  isStreaming: boolean;
  isMobile: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

/** Build a tree from flat thread list */
function buildTree(threads: Thread[]): { roots: Thread[]; childrenMap: Map<string, Thread[]> } {
  const childrenMap = new Map<string, Thread[]>();
  const roots: Thread[] = [];

  for (const t of threads) {
    if (t.parentId) {
      const siblings = childrenMap.get(t.parentId) ?? [];
      siblings.push(t);
      childrenMap.set(t.parentId, siblings);
    } else {
      roots.push(t);
    }
  }
  return { roots, childrenMap };
}

export function ThreadSidebar({
  activeThreadId,
  onSelectThread,
  onNewThread,
  onBranchThread,
  onThreadDeleted,
  onAllThreadsCleared,
  isStreaming,
  isMobile,
  isOpen,
  onToggle,
}: ThreadSidebarProps) {
  const { data: threads = [], isLoading: threadsLoading } = useThreads();
  const timezone = useAppTimezone();
  const deleteThreadMut = useDeleteThread();
  const renameThreadMut = useRenameThread();
  const clearAllMut = useClearAllThreads();

  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(160, Math.min(400, startW + ev.clientX - startX)));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  useEffect(() => {
    if (renamingThreadId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingThreadId]);

  // Auto-expand the active thread's ancestors
  useEffect(() => {
    if (!activeThreadId || !threads.length) return;
    const parentMap = new Map(threads.map(t => [t.id, t.parentId]));
    const toExpand = new Set<string>();
    let current = parentMap.get(activeThreadId);
    while (current) {
      toExpand.add(current);
      current = parentMap.get(current);
    }
    if (toExpand.size) setExpanded(prev => new Set([...prev, ...toExpand]));
  }, [activeThreadId, threads]);

  const { roots, childrenMap } = useMemo(() => buildTree(threads), [threads]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

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

  const renderThread = (thread: Thread, depth: number) => {
    const children = childrenMap.get(thread.id) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(thread.id);
    const isBranch = !!thread.parentId;

    return (
      <div key={thread.id}>
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (renamingThreadId !== thread.id) onSelectThread(thread.id);
            }
          }}
          onClick={() => {
            if (renamingThreadId !== thread.id) onSelectThread(thread.id);
          }}
          className={cn(
            "group flex cursor-pointer items-center justify-between border-b border-border/30 py-1.5 pr-2 transition-colors",
            thread.id === activeThreadId
              ? "bg-primary/15 border-l-2 border-l-primary text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
          style={{ paddingLeft: 10 + depth * 14 }}
        >
          <div className="min-w-0 flex-1 flex items-center gap-1">
            {/* Expand/collapse toggle */}
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(thread.id); }}
                className="shrink-0 p-0.5 rounded hover:bg-accent"
              >
                <ChevronRightIcon className={cn("size-3 transition-transform", isExpanded && "rotate-90")} />
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            {/* Branch icon for child threads */}
            {isBranch && <GitBranchIcon className="size-3 shrink-0 text-muted-foreground/50" />}

            <div className="min-w-0 flex-1">
              {renamingThreadId === thread.id ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleConfirmRename(); }
                      if (e.key === "Escape") handleCancelRename();
                    }}
                    onBlur={handleConfirmRename}
                    className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-xs text-foreground outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); handleConfirmRename(); }}>
                    <CheckIcon className="size-3" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); handleCancelRename(); }}>
                    <XIcon className="size-3" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="shrink-0 text-[10px] text-muted-foreground/50">{formatWithTimezone(parseApiDate(thread.updatedAt), { month: "short", day: "numeric" }, timezone)}</span>
                    <span className="truncate text-xs font-medium">{thread.title}</span>
                    {thread.messageCount > 0 && (
                      <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]">
                        {thread.messageCount}
                      </Badge>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {renamingThreadId !== thread.id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStartRename(thread); }}>
                  <PencilIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onBranchThread(thread.id); }}>
                  <GitBranchIcon />
                  Branch
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => { e.stopPropagation(); handleDeleteThread(thread.id); }}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Render children if expanded */}
        {hasChildren && isExpanded && children.map(child => renderThread(child, depth + 1))}
      </div>
    );
  };

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between gap-2 px-3 py-2 pl-4">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="shrink-0">Threads</span>
          <InfoBubble text="Each thread is a separate conversation. Branch a thread to explore a different direction while keeping the original." side="right" />
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

        {!threadsLoading && roots.map(thread => renderThread(thread, 0))}
      </div>
    </>
  );

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

  if (!isOpen) return null;

  return (
    <aside className="relative z-30 flex flex-col overflow-hidden border-r border-border bg-background" style={{ width: sidebarWidth }}>
      {sidebarContent}
      <div onMouseDown={onDragStart} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors" />
    </aside>
  );
}
