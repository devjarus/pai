import { ListTodoIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TaskItem {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate?: string;
}

interface ToolTaskListProps {
  state: string;
  input?: unknown;
  output?: TaskItem[] | string;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  medium: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  low: "bg-muted text-muted-foreground border-border",
};

function parseTasks(output: TaskItem[] | string): TaskItem[] {
  if (Array.isArray(output)) return output;
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // not JSON
    }
  }
  return [];
}

export function ToolTaskList({ state, output }: ToolTaskListProps) {
  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <ListTodoIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">Loading tasks...</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Failed to load tasks.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available" && output) {
    const tasks = parseTasks(output);

    if (tasks.length === 0) {
      return (
        <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">No tasks found.</span>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {tasks.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "h-4 px-1 text-[9px] font-medium",
                    PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.low,
                  )}
                >
                  {task.priority}
                </Badge>
                <span className={cn(
                  "flex-1 truncate text-xs",
                  task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                )}>
                  {task.title}
                </span>
                {task.dueDate && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {task.dueDate}
                  </span>
                )}
              </div>
            ))}
            {tasks.length > 8 && (
              <span className="mt-1 text-[10px] text-muted-foreground">
                +{tasks.length - 8} more
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
