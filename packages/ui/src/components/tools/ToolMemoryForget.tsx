import { TrashIcon, CheckIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolMemoryForgetProps {
  state: string;
  input?: { id?: string };
  output?: { ok?: boolean; message?: string; error?: string } | string;
}

export function ToolMemoryForget({ state, output }: ToolMemoryForgetProps) {
  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <TrashIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">Forgetting belief...</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">Failed to forget belief.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    const outObj = typeof output === "object" && output ? output as { ok?: boolean; message?: string; error?: string } : null;
    const outStr = typeof output === "string" ? output : null;

    if (outObj?.error) {
      return (
        <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
            <span className="text-xs text-destructive">{outObj.error}</span>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <CheckIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="text-xs text-foreground">
            {outObj?.message || outStr || "Belief forgotten."}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
