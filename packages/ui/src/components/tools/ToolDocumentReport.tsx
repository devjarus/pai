import { FileTextIcon, CheckIcon, AlertCircleIcon, LoaderIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ToolDocumentReportProps {
  state: string;
  input?: { title?: string; content?: string };
  output?: { ok?: boolean; artifactId?: string; fileName?: string; title?: string; downloadUrl?: string; error?: string } | string;
}

export function ToolDocumentReport({ state, input, output }: ToolDocumentReportProps) {
  if (state === "input-available") {
    const title = input?.title ?? "report";
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Generating report: {title}...
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
          <span className="text-xs text-destructive">Failed to generate report.</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    const outObj = typeof output === "object" && output ? output : null;
    const title = outObj?.title ?? outObj?.fileName ?? "Report";
    const downloadUrl = outObj?.downloadUrl;
    const error = outObj?.error;

    if (error) {
      return (
        <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
            <span className="text-xs text-destructive">{error}</span>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <FileTextIcon className="size-3.5 shrink-0 text-green-500" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            <CheckIcon className="mr-1 inline size-3 text-green-500" />
            Report ready: <span className="font-medium">{title}</span>
          </span>
          {downloadUrl && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                asChild
              >
                <a href={`${downloadUrl}/view`} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon className="size-3" />
                  View
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                asChild
              >
                <a href={downloadUrl} download>
                  <DownloadIcon className="size-3" />
                  Download
                </a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}
