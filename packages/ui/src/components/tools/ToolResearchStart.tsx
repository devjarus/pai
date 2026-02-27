import { SearchIcon, AlertCircleIcon, LoaderIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolResearchStartProps {
  state: string;
  input?: { goal?: string };
  output?: string;
}

export function ToolResearchStart({ state, input, output }: ToolResearchStartProps) {
  const goal = input?.goal;

  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Starting research{goal ? `: "${goal.slice(0, 80)}"` : "..."}
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
          <span className="text-xs text-destructive">Failed to start research.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    return (
      <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <SearchIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="text-xs text-foreground">
            {typeof output === "string" ? output.slice(0, 120) : `Research started${goal ? `: "${goal.slice(0, 60)}"` : ""}`}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
