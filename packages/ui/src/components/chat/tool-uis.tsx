/**
 * Registers all PAI tool card components with assistant-ui's makeAssistantToolUI.
 *
 * Each tool UI bridges assistant-ui's ToolCallMessagePartComponent props
 * (toolName, args, result, status) to our existing tool cards which expect
 * (state, input, output) with state being "input-available" | "output-available" | "output-error".
 */
import { makeAssistantToolUI } from "@assistant-ui/react";
import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { ToolSearchResults } from "../tools/ToolSearchResults";
import { ToolTaskList } from "../tools/ToolTaskList";
import { ToolTaskAction } from "../tools/ToolTaskAction";
import { ToolMemoryRecall } from "../tools/ToolMemoryRecall";
import { ToolMemoryAction } from "../tools/ToolMemoryAction";
import { ToolMemoryForget } from "../tools/ToolMemoryForget";
import { ToolBeliefsList } from "../tools/ToolBeliefsList";
import { ToolKnowledgeSearch } from "../tools/ToolKnowledgeSearch";
import { ToolKnowledgeSources } from "../tools/ToolKnowledgeSources";
import { ToolKnowledgeAction } from "../tools/ToolKnowledgeAction";
import { ToolCurateMemory } from "../tools/ToolCurateMemory";
import { ToolCuratorAction } from "../tools/ToolCuratorAction";
import { ToolResearchStart } from "../tools/ToolResearchStart";
import { ToolSwarmStart } from "../tools/ToolSwarmStart";
import { ToolScheduleAction } from "../tools/ToolScheduleAction";
import { ToolDocumentReport } from "../tools/ToolDocumentReport";
import { ToolBrowseAction } from "../tools/ToolBrowseAction";
import { ArtifactGallery } from "../results/ArtifactGallery";
import { ResultRenderer } from "../results/ResultRenderer";
import {
  artifactReferencesToVisuals,
  buildVisualResultSpec,
} from "@/lib/report-presentation";
import type { ArtifactReference } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Map assistant-ui status to our tool card state */
function mapStatus(status: ToolCallMessagePartStatus | undefined): string {
  if (!status) return "output-available";
  switch (status.type) {
    case "running":
      return "input-available";
    case "complete":
      return "output-available";
    case "incomplete":
      return "output-error";
    case "requires-action":
      return "input-available";
    default:
      return "output-available";
  }
}

export const WebSearchToolUI = makeAssistantToolUI({
  toolName: "web_search",
  render: ({ args, result, status }) => (
    <ToolSearchResults state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const TaskListToolUI = makeAssistantToolUI({
  toolName: "task_list",
  render: ({ args, result, status }) => (
    <ToolTaskList state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const TaskAddToolUI = makeAssistantToolUI({
  toolName: "task_add",
  render: ({ args, result, status }) => (
    <ToolTaskAction state={mapStatus(status)} toolName="task_add" input={args} output={result as any} />
  ),
});

export const TaskDoneToolUI = makeAssistantToolUI({
  toolName: "task_done",
  render: ({ args, result, status }) => (
    <ToolTaskAction state={mapStatus(status)} toolName="task_done" input={args} output={result as any} />
  ),
});

export const MemoryRecallToolUI = makeAssistantToolUI({
  toolName: "memory_recall",
  render: ({ args, result, status }) => (
    <ToolMemoryRecall state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const MemoryRememberToolUI = makeAssistantToolUI({
  toolName: "memory_remember",
  render: ({ args, result, status }) => (
    <ToolMemoryAction state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const MemoryBeliefsToolUI = makeAssistantToolUI({
  toolName: "memory_beliefs",
  render: ({ args, result, status }) => (
    <ToolBeliefsList state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const MemoryForgetToolUI = makeAssistantToolUI({
  toolName: "memory_forget",
  render: ({ args, result, status }) => (
    <ToolMemoryForget state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const KnowledgeSearchToolUI = makeAssistantToolUI({
  toolName: "knowledge_search",
  render: ({ args, result, status }) => (
    <ToolKnowledgeSearch state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const KnowledgeSourcesToolUI = makeAssistantToolUI({
  toolName: "knowledge_sources",
  render: ({ args, result, status }) => (
    <ToolKnowledgeSources state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const LearnFromUrlToolUI = makeAssistantToolUI({
  toolName: "learn_from_url",
  render: ({ args, result, status }) => (
    <ToolKnowledgeAction state={mapStatus(status)} toolName="learn_from_url" input={args} output={result as any} />
  ),
});

export const KnowledgeForgetToolUI = makeAssistantToolUI({
  toolName: "knowledge_forget",
  render: ({ args, result, status }) => (
    <ToolKnowledgeAction state={mapStatus(status)} toolName="knowledge_forget" input={args} output={result as any} />
  ),
});

export const JobStatusToolUI = makeAssistantToolUI({
  toolName: "job_status",
  render: ({ args, result, status }) => (
    <ToolKnowledgeAction state={mapStatus(status)} toolName="job_status" input={args} output={result as any} />
  ),
});

export const CurateMemoryToolUI = makeAssistantToolUI({
  toolName: "curate_memory",
  render: ({ args, result, status }) => (
    <ToolCurateMemory state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const FixIssuesToolUI = makeAssistantToolUI({
  toolName: "fix_issues",
  render: ({ args, result, status }) => (
    <ToolCuratorAction state={mapStatus(status)} toolName="fix_issues" input={args} output={result as any} />
  ),
});

export const ListBeliefsToolUI = makeAssistantToolUI({
  toolName: "list_beliefs",
  render: ({ args, result, status }) => (
    <ToolCuratorAction state={mapStatus(status)} toolName="list_beliefs" input={args} output={result as any} />
  ),
});

export const ResearchStartToolUI = makeAssistantToolUI({
  toolName: "research_start",
  render: ({ args, result, status }) => (
    <ToolResearchStart state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const SwarmStartToolUI = makeAssistantToolUI({
  toolName: "swarm_start",
  render: ({ args, result, status }) => (
    <ToolSwarmStart state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const ProgramCreateToolUI = makeAssistantToolUI({
  toolName: "program_create",
  render: ({ args, result, status }) => (
    <ToolScheduleAction state={mapStatus(status)} toolName="program_create" input={args} output={result as any} />
  ),
});

export const ProgramListToolUI = makeAssistantToolUI({
  toolName: "program_list",
  render: ({ args, result, status }) => (
    <ToolScheduleAction state={mapStatus(status)} toolName="program_list" input={args} output={result as any} />
  ),
});

export const ProgramDeleteToolUI = makeAssistantToolUI({
  toolName: "program_delete",
  render: ({ args, result, status }) => (
    <ToolScheduleAction state={mapStatus(status)} toolName="program_delete" input={args} output={result as any} />
  ),
});

export const ScheduleCreateToolUI = makeAssistantToolUI({
  toolName: "schedule_create",
  render: ({ args, result, status }) => (
    <ToolScheduleAction state={mapStatus(status)} toolName="schedule_create" input={args} output={result as any} />
  ),
});

export const ScheduleListToolUI = makeAssistantToolUI({
  toolName: "schedule_list",
  render: ({ args, result, status }) => (
    <ToolScheduleAction state={mapStatus(status)} toolName="schedule_list" input={args} output={result as any} />
  ),
});

export const ScheduleDeleteToolUI = makeAssistantToolUI({
  toolName: "schedule_delete",
  render: ({ args, result, status }) => (
    <ToolScheduleAction state={mapStatus(status)} toolName="schedule_delete" input={args} output={result as any} />
  ),
});

export const GenerateReportToolUI = makeAssistantToolUI({
  toolName: "generate_report",
  render: ({ args, result, status }) => (
    <ToolDocumentReport state={mapStatus(status)} input={args} output={result as any} />
  ),
});

export const RunCodeToolUI = makeAssistantToolUI({
  toolName: "run_code",
  render: ({ args, result, status }) => {
    const state = mapStatus(status);
    const input = args as { language?: string; code?: string; purpose?: string };
    const output = result as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      artifacts?: Array<{ id: string; name: string; mimeType: string }>;
      error?: string;
    } | undefined;
    const artifacts: ArtifactReference[] = output?.artifacts ?? [];
    const visuals = artifactReferencesToVisuals(artifacts);
    const files = artifacts.filter((artifact) => !artifact.mimeType.startsWith("image/"));
    const generatedSpec = buildVisualResultSpec({
      title: visuals.length > 1 ? "Generated visuals" : "Generated visual",
      subtitle: input.purpose ?? (input.language ? `Created with ${input.language}` : undefined),
      visuals,
    });
    const hasError = state === "output-error" || Boolean(output?.error);

    if (state === "input-available") {
      return (
        <div className="my-2 rounded-lg border border-border/30 bg-card/50 p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Running {input.language ?? "code"}...
          </div>
        </div>
      );
    }

    return (
      <div
        className={`my-2 rounded-lg p-3 space-y-2 ${
          hasError
            ? "border border-red-500/30 bg-red-500/5"
            : "border border-border/30 bg-card/50"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className={`text-xs font-medium uppercase tracking-wide ${
              hasError ? "text-red-400" : "text-muted-foreground"
            }`}
          >
            {hasError ? "Code execution completed with errors" : input.language ?? "Code"}
          </div>
          {typeof output?.exitCode === "number" && (
            <div className={`text-xs ${hasError ? "text-red-300/80" : "text-muted-foreground"}`}>
              Exit code: {output.exitCode}
            </div>
          )}
        </div>
        {generatedSpec && (
          <div className="rounded-lg border border-border/20 bg-background/40 p-3">
            <ResultRenderer spec={generatedSpec} />
          </div>
        )}
        {input.code && (
          <pre className="overflow-x-auto rounded bg-background/60 p-2 text-xs font-mono whitespace-pre-wrap">{input.code}</pre>
        )}
        {output?.stdout && (
          <>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stdout</div>
            <pre className="overflow-x-auto rounded bg-background/60 p-2 text-xs font-mono whitespace-pre-wrap">{output.stdout}</pre>
          </>
        )}
        {output?.stderr && (
          <>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stderr</div>
            <pre className="overflow-x-auto rounded bg-background/60 p-2 text-xs font-mono whitespace-pre-wrap">{output.stderr}</pre>
          </>
        )}
        {output?.error && (
          <>
            <div className="text-xs font-medium uppercase tracking-wide text-red-400">Error</div>
            <pre className="overflow-x-auto rounded bg-red-500/10 p-2 text-xs font-mono text-red-400 whitespace-pre-wrap">{output.error}</pre>
          </>
        )}
        {hasError && artifacts.length > 0 && (
          <p className="text-xs text-red-200/80">
            Generated files were still saved and may be usable.
          </p>
        )}
        {files.length > 0 && (
          <ArtifactGallery artifacts={files} title={hasError ? "Generated files" : "Files"} />
        )}
      </div>
    );
  },
});

export const AgentCuratorToolUI = makeAssistantToolUI({
  toolName: "agent_curator",
  render: ({ args, result, status }) => {
    const state = mapStatus(status);
    const input = args as { task?: string };
    const output = result as { response?: string } | undefined;

    if (state === "input-available") {
      return (
        <div className="my-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Delegating to Memory Curator...
          </div>
          {input.task && <p className="mt-1 text-xs text-muted-foreground">{input.task}</p>}
        </div>
      );
    }

    return (
      <div className="my-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
        <div className="text-xs font-medium text-violet-400 uppercase tracking-wide">Memory Curator</div>
        {output?.response && (
          <p className="text-sm text-foreground whitespace-pre-wrap">{output.response}</p>
        )}
      </div>
    );
  },
});

export const BrowseNavigateToolUI = makeAssistantToolUI({
  toolName: "browse_navigate",
  render: ({ args, result, status }) => (
    <ToolBrowseAction state={mapStatus(status)} toolName="browse_navigate" input={args} output={result as any} />
  ),
});

export const BrowseSnapshotToolUI = makeAssistantToolUI({
  toolName: "browse_snapshot",
  render: ({ args, result, status }) => (
    <ToolBrowseAction state={mapStatus(status)} toolName="browse_snapshot" input={args} output={result as any} />
  ),
});

export const BrowseActionToolUI = makeAssistantToolUI({
  toolName: "browse_action",
  render: ({ args, result, status }) => (
    <ToolBrowseAction state={mapStatus(status)} toolName="browse_action" input={args} output={result as any} />
  ),
});

export const BrowseTextToolUI = makeAssistantToolUI({
  toolName: "browse_text",
  render: ({ args, result, status }) => (
    <ToolBrowseAction state={mapStatus(status)} toolName="browse_text" input={args} output={result as any} />
  ),
});

export const BrowseScreenshotToolUI = makeAssistantToolUI({
  toolName: "browse_screenshot",
  render: ({ args, result, status }) => (
    <ToolBrowseAction state={mapStatus(status)} toolName="browse_screenshot" input={args} output={result as any} />
  ),
});

/**
 * Array of all tool UI components. Render these inside AssistantRuntimeProvider
 * to register them with assistant-ui's tool rendering system.
 */
export const AllToolUIs = () => (
  <>
    <WebSearchToolUI />
    <TaskListToolUI />
    <TaskAddToolUI />
    <TaskDoneToolUI />
    <MemoryRecallToolUI />
    <MemoryRememberToolUI />
    <MemoryBeliefsToolUI />
    <MemoryForgetToolUI />
    <KnowledgeSearchToolUI />
    <KnowledgeSourcesToolUI />
    <LearnFromUrlToolUI />
    <KnowledgeForgetToolUI />
    <JobStatusToolUI />
    <CurateMemoryToolUI />
    <FixIssuesToolUI />
    <ListBeliefsToolUI />
    <ResearchStartToolUI />
    <SwarmStartToolUI />
    <ProgramCreateToolUI />
    <ProgramListToolUI />
    <ProgramDeleteToolUI />
    <ScheduleCreateToolUI />
    <ScheduleListToolUI />
    <ScheduleDeleteToolUI />
    <GenerateReportToolUI />
    <RunCodeToolUI />
    <AgentCuratorToolUI />
    <BrowseNavigateToolUI />
    <BrowseSnapshotToolUI />
    <BrowseActionToolUI />
    <BrowseTextToolUI />
    <BrowseScreenshotToolUI />
  </>
);
