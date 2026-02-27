import { BookOpenIcon, CheckIcon, AlertCircleIcon, LoaderIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ToolKnowledgeActionProps {
  state: string;
  toolName: "learn_from_url" | "knowledge_forget" | "knowledge_status" | "job_status";
  input?: { url?: string; id?: string };
  output?: { ok?: boolean; message?: string; title?: string; chunks?: number } | string | unknown[];
}

export function ToolKnowledgeAction({ state, toolName, input, output }: ToolKnowledgeActionProps) {
  const inputObj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  if (state === "input-available") {
    const messages: Record<string, string> = {
      learn_from_url: `Learning from ${inputObj.url ? `"${String(inputObj.url).slice(0, 60)}"` : "URL"}...`,
      knowledge_forget: "Removing source...",
      knowledge_status: "Checking crawl status...",
      job_status: "Checking background job status...",
    };

    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          {toolName === "knowledge_status" || toolName === "job_status" ? (
            <LoaderIcon className="size-3.5 shrink-0 animate-spin text-primary" />
          ) : (
            <BookOpenIcon className="size-3.5 shrink-0 animate-pulse text-primary" />
          )}
          <span className="text-xs text-muted-foreground">{messages[toolName]}</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-error") {
    const errorMessages: Record<string, string> = {
      learn_from_url: "Failed to learn from URL.",
      knowledge_forget: "Failed to remove source.",
      knowledge_status: "Failed to check crawl status.",
      job_status: "Failed to check job status.",
    };

    return (
      <Card className="gap-0 rounded-lg border-destructive/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
          <span className="text-xs text-destructive">{errorMessages[toolName]}</span>
        </CardContent>
      </Card>
    );
  }

  if (state === "output-available") {
    const outObj = typeof output === "object" && output && !Array.isArray(output) ? output : null;
    const outStr = typeof output === "string" ? output : null;

    if (toolName === "learn_from_url") {
      const title = outObj?.title || "";
      const chunks = outObj?.chunks;
      const message = outObj?.message || outStr || "Learned from URL";

      return (
        <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <CheckIcon className="size-3.5 shrink-0 text-green-500" />
            <span className="text-xs text-foreground">
              {title ? (
                <>
                  Learned from <span className="font-medium">{title}</span>
                  {chunks != null && ` — ${chunks} chunks`}
                </>
              ) : (
                message
              )}
            </span>
          </CardContent>
        </Card>
      );
    }

    if (toolName === "knowledge_forget") {
      return (
        <Card className="gap-0 rounded-lg border-green-500/10 py-0 shadow-none">
          <CardContent className="flex items-center gap-2 px-3 py-2.5">
            <CheckIcon className="size-3.5 shrink-0 text-green-500" />
            <span className="text-xs text-foreground">
              {outObj?.message || outStr || "Source removed."}
            </span>
          </CardContent>
        </Card>
      );
    }

    if (toolName === "job_status") {
      const jobs = Array.isArray(output) ? output : outObj ? [outObj] : [];
      if (jobs.length === 0) {
        return (
          <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
            <CardContent className="flex items-center gap-2 px-3 py-2.5">
              <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-foreground">No background jobs running.</span>
            </CardContent>
          </Card>
        );
      }
      return (
        <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
          <CardContent className="space-y-1.5 px-3 py-2.5">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {jobs.map((job: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs text-foreground">
                {job.status === "running" ? (
                  <LoaderIcon className="size-3 shrink-0 animate-spin text-primary" />
                ) : (
                  <CheckIcon className="size-3 shrink-0 text-green-500" />
                )}
                <span className="truncate">{job.label || job.type || "Job"}</span>
                {job.progress && <span className="text-muted-foreground">{job.progress}</span>}
                <span className="text-muted-foreground">{job.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      );
    }

    // knowledge_status
    return (
      <Card className="gap-0 rounded-lg border-border/50 py-0 shadow-none">
        <CardContent className="flex items-center gap-2 px-3 py-2.5">
          <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs text-foreground">
            {outObj?.message || outStr || "Crawl status retrieved."}
          </span>
        </CardContent>
      </Card>
    );
  }

  return null;
}
