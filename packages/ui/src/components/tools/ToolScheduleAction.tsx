import { CalendarClockIcon, AlertCircleIcon, LoaderIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolScheduleActionProps {
  toolName: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

const labels: Record<string, string> = {
  schedule_create: "Creating schedule",
  schedule_list: "Listing schedules",
  schedule_delete: "Deleting schedule",
};

export function ToolScheduleAction({ toolName, state, input, output }: ToolScheduleActionProps) {
  const label = labels[toolName] ?? "Managing schedule";

  if (state === "input-available") {
    const detail = input?.label ?? input?.id ?? "";
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            {label}{detail ? `: "${String(detail).slice(0, 60)}"` : "..."}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">{label} failed.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    const text = typeof output === "string" ? output.slice(0, 120) : `${label.replace(/ing/, "ed")} successfully`;
    return (
      <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <CalendarClockIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="text-xs text-foreground">{text}</span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
