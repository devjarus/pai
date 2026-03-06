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
    const input = args as { language?: string; code?: string };
    const output = result as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      artifacts?: Array<{ id: string; name: string; mimeType: string }>;
      error?: string;
    } | undefined;

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

    if (state === "output-error" || output?.error) {
      return (
        <div className="my-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="text-sm font-medium text-red-400">Code execution failed</div>
          {input.code && (
            <pre className="overflow-x-auto rounded bg-background/60 p-2 text-xs font-mono whitespace-pre-wrap">{input.code}</pre>
          )}
          {output?.error && (
            <pre className="overflow-x-auto rounded bg-red-500/10 p-2 text-xs font-mono text-red-400 whitespace-pre-wrap">{output.error}</pre>
          )}
        </div>
      );
    }

    return (
      <div className="my-2 rounded-lg border border-border/30 bg-card/50 p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{input.language ?? "Code"}</div>
        {input.code && (
          <pre className="overflow-x-auto rounded bg-background/60 p-2 text-xs font-mono whitespace-pre-wrap">{input.code}</pre>
        )}
        {typeof output?.exitCode === "number" && (
          <div className="text-xs text-muted-foreground">Exit code: {output.exitCode}</div>
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
        {output?.artifacts && output.artifacts.length > 0 && (
          <ArtifactGallery artifacts={output.artifacts} title="Files" />
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
