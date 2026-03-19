import { AlertTriangle, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QueryErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function QueryError({ message, onRetry }: QueryErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <AlertTriangle className="h-8 w-8 opacity-40" />
      <p className="text-sm">{message ?? "Something went wrong loading this data."}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  );
}
