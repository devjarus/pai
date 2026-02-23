import { ListTodoIcon, CheckIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolTaskActionProps {
  state: string;
  toolName: "task_add" | "task_done";
  input?: unknown;
  output?: { ok?: boolean; title?: string; message?: string; id?: string; priority?: string };
}

export function ToolTaskAction({ state, toolName, input, output }: ToolTaskActionProps) {
  const isAdd = toolName === "task_add";
  const inputObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <ListTodoIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">
            {isAdd
              ? `Creating task${inputObj.title ? `: "${inputObj.title}"` : "..."}`
              : "Completing task..."}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">
            {isAdd ? "Failed to create task." : "Failed to complete task."}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    const title = output?.title || (inputObj.title as string) || "";
    const message = output?.message || (isAdd ? "Task created" : "Task completed");

    return (
      <Card className="my-2 gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <CheckIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="text-xs text-foreground">
            {message}
            {title && (
              <>
                {": "}
                <span className="font-medium">{title}</span>
              </>
            )}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
