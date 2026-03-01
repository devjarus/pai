import {
  BrainIcon,
  Trash2Icon,
  PanelLeftIcon,
  PanelLeftCloseIcon,
} from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
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
  onClear: () => void;
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
  onClear,
}: ChatHeaderProps) {
  const { data: agents = [] } = useAgents();

  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-3 py-3 md:px-4">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        {/* Thread sidebar toggle */}
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
                {a.displayName ?? a.name}{a.dynamic ? " ✦" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1.5">
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
    </header>
  );
}
