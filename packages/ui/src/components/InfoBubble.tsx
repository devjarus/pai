import { InfoIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoBubbleProps {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function InfoBubble({ text, side = "top", className }: InfoBubbleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:text-muted-foreground",
            className,
          )}
          tabIndex={-1}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-64 text-xs leading-relaxed"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
