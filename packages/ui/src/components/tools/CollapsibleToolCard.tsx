import { type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CollapsibleToolCardProps {
  icon: ReactNode;
  label: ReactNode;
  children: ReactNode;
  /** Start expanded (default false — collapsed) */
  defaultOpen?: boolean;
  /** Border color class override (e.g. for error states) */
  borderClass?: string;
}

/**
 * A tool card with a clickable header that toggles the body content.
 * Uses shadcn Collapsible (Radix primitive) for accessible expand/collapse.
 */
export function CollapsibleToolCard({
  icon,
  label,
  children,
  defaultOpen = false,
  borderClass,
}: CollapsibleToolCardProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <Card className={cn("my-2 gap-0 rounded-lg border-border/50 py-0 shadow-none", borderClass)}>
        <CardContent className="px-3 py-0">
          <CollapsibleTrigger className="flex w-full items-center gap-2 py-2.5 text-left">
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 [[data-state=open]>&]:rotate-90" />
            {icon}
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {label}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-2.5">
            {children}
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
