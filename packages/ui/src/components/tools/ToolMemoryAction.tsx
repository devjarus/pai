import { DatabaseIcon, AlertCircleIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolMemoryActionProps {
  state: string;
  input?: unknown;
  output?: string;
}

export function ToolMemoryAction({ state, input, output }: ToolMemoryActionProps) {
  const inputObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  if (state === "input-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <DatabaseIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-xs text-muted-foreground">
            Saving to memory
            {inputObj.text ? (
              <>
                {": "}
                <span className="font-medium text-foreground">
                  {String(inputObj.text).slice(0, 80)}
                  {String(inputObj.text).length > 80 ? "..." : ""}
                </span>
              </>
            ) : (
              "..."
            )}
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
          <span className="text-xs text-destructive">Failed to save to memory.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    return (
      <Card className="my-2 gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <DatabaseIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="text-xs text-foreground">
            {output || "Saved to memory."}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
