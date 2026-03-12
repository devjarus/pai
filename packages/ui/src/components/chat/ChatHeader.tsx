import { useMemo } from "react";
import {
  BrainIcon,
  Trash2Icon,
  PanelLeftIcon,
  PanelLeftCloseIcon,
  GitBranchIcon,
  ChevronRightIcon,
  CalendarClockIcon,
} from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
import { useThreads } from "@/hooks/use-threads";
import type { Thread } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatHeaderProps {
  activeThread: Thread | undefined;
  activeThreadId: string | null;
  selectedAgent: string | undefined;
  onSelectAgent: (agent: string | undefined) => void;
  threadSidebarOpen: boolean;
  onToggleThreadSidebar: () => void;
  showMemories: boolean;
  onToggleMemories: () => void;
  memoryCount: number;
  canKeepWatching?: boolean;
  keepWatchingPending?: boolean;
  keepWatchingLabel?: string;
  keepWatchingTooltip?: string;
  onKeepWatching?: () => void;
  onClear: () => void;
  onSelectThread?: (threadId: string) => void;
}

export function ChatHeader({
  activeThread,
  activeThreadId,
  selectedAgent,
  onSelectAgent,
  threadSidebarOpen,
  onToggleThreadSidebar,
  showMemories,
  onToggleMemories,
  memoryCount,
  canKeepWatching = false,
  keepWatchingPending = false,
  keepWatchingLabel = "Keep watching",
  keepWatchingTooltip = "Turn this thread into a Program",
  onKeepWatching,
  onClear,
  onSelectThread,
}: ChatHeaderProps) {
  const { data: agents = [] } = useAgents();
  const { data: threads = [] } = useThreads();

  // Build breadcrumb: walk up parent chain
  const breadcrumb = useMemo(() => {
    if (!activeThread?.parentId || !threads.length) return [];
    const threadMap = new Map(threads.map(t => [t.id, t]));
    const crumbs: Thread[] = [];
    let current = activeThread.parentId ? threadMap.get(activeThread.parentId) : undefined;
    while (current) {
      crumbs.unshift(current);
      current = current.parentId ? threadMap.get(current.parentId) : undefined;
    }
    return crumbs;
  }, [activeThread, threads]);

  return (
    <header className="flex flex-col border-b border-border bg-background">
      {/* Breadcrumb — only for child threads */}
      {breadcrumb.length > 0 && onSelectThread && (
        <div className="flex items-center gap-1 border-b border-border/50 px-3 py-1.5 md:px-4">
          <GitBranchIcon className="size-3 shrink-0 text-muted-foreground/60" />
          {breadcrumb.map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRightIcon className="size-3 text-muted-foreground/40" />}
              <button
                onClick={() => onSelectThread(ancestor.id)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors truncate max-w-32"
              >
                {ancestor.title}
              </button>
            </span>
          ))}
          <ChevronRightIcon className="size-3 text-muted-foreground/40" />
          <span className="text-[11px] text-foreground font-medium truncate max-w-32">
            {activeThread?.title}
          </span>
        </div>
      )}

      {/* Main header row */}
      <div className="flex items-center justify-between px-3 py-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleThreadSidebar}
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
                onSelectAgent(e.target.value || undefined)
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
          {activeThreadId && onKeepWatching && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onKeepWatching}
                  disabled={!canKeepWatching || keepWatchingPending}
                  aria-label="Keep watching this"
                  className="gap-1.5"
                >
                  <CalendarClockIcon className="size-3.5" />
                  <span className="hidden text-xs lg:inline">
                    {keepWatchingPending ? "Creating..." : keepWatchingLabel}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {keepWatchingTooltip}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showMemories ? "secondary" : "ghost"}
                size="sm"
                onClick={onToggleMemories}
                className={cn(
                  showMemories && "bg-primary/15 text-primary hover:bg-primary/20",
                )}
              >
                <BrainIcon className="size-3.5" />
                <span className="hidden text-xs md:inline">
                  Memories
                  {memoryCount > 0 && ` (${memoryCount})`}
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
                  onClick={onClear}
                >
                  <Trash2Icon className="size-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear messages</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
}
