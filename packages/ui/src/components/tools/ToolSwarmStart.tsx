import {
  NetworkIcon,
  AlertCircleIcon,
  LoaderIcon,
  PlaneIcon,
  TrendingUpIcon,
  BitcoinIcon,
  NewspaperIcon,
  GitCompareArrowsIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolSwarmStartProps {
  state: string;
  input?: { goal?: string; type?: string };
  output?: unknown;
}

/** Extract a safe display string from tool output, never showing raw JSON */
function safeOutputText(output: unknown, fallback: string): string {
  if (typeof output === "string") {
    // If the string looks like JSON, don't display it raw
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return fallback;
    }
    return output.slice(0, 120);
  }
  return fallback;
}

/** Icon and color for the swarm domain type */
function TypeIcon({ type }: { type?: string }) {
  switch (type) {
    case "flight":
      return <PlaneIcon className="size-3.5 shrink-0 text-purple-500" />;
    case "stock":
      return <TrendingUpIcon className="size-3.5 shrink-0 text-purple-500" />;
    case "crypto":
      return <BitcoinIcon className="size-3.5 shrink-0 text-purple-500" />;
    case "news":
      return <NewspaperIcon className="size-3.5 shrink-0 text-purple-500" />;
    case "comparison":
      return <GitCompareArrowsIcon className="size-3.5 shrink-0 text-purple-500" />;
    default:
      return <NetworkIcon className="size-3.5 shrink-0 text-purple-500" />;
  }
}

/** Human-readable label for the swarm domain type */
function typeLabel(type?: string): string {
  switch (type) {
    case "flight":
      return "flight";
    case "stock":
      return "stock";
    case "crypto":
      return "crypto";
    case "news":
      return "news";
    case "comparison":
      return "comparison";
    default:
      return "swarm";
  }
}

export function ToolSwarmStart({ state, input, output }: ToolSwarmStartProps) {
  const goal = input?.goal;
  const type = input?.type;

  if (state === "input-available") {
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Starting {typeLabel(type)} analysis{goal ? `: "${goal.slice(0, 80)}"` : "..."}
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
          <span className="text-xs text-destructive">Failed to start {typeLabel(type)} analysis.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    const fallback = `Swarm ${typeLabel(type)} analysis started${goal ? `: "${goal.slice(0, 60)}"` : ""}`;
    return (
      <Card className="gap-0 rounded-lg border-purple-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <TypeIcon type={type} />
          <span className="text-xs text-foreground">
            {safeOutputText(output, fallback)}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
