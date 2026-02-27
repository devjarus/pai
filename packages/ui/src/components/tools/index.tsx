import type { ReactNode } from "react";
import { ToolSearchResults } from "./ToolSearchResults";
import { ToolTaskList } from "./ToolTaskList";
import { ToolTaskAction } from "./ToolTaskAction";
import { ToolMemoryRecall } from "./ToolMemoryRecall";
import { ToolMemoryAction } from "./ToolMemoryAction";
import { ToolMemoryForget } from "./ToolMemoryForget";
import { ToolBeliefsList } from "./ToolBeliefsList";
import { ToolKnowledgeSearch } from "./ToolKnowledgeSearch";
import { ToolKnowledgeSources } from "./ToolKnowledgeSources";
import { ToolKnowledgeAction } from "./ToolKnowledgeAction";
import { ToolCurateMemory } from "./ToolCurateMemory";
import { ToolCuratorAction } from "./ToolCuratorAction";

export { ToolSearchResults } from "./ToolSearchResults";
export { ToolTaskList } from "./ToolTaskList";
export { ToolTaskAction } from "./ToolTaskAction";
export { ToolMemoryRecall } from "./ToolMemoryRecall";
export { ToolMemoryAction } from "./ToolMemoryAction";
export { ToolMemoryForget } from "./ToolMemoryForget";
export { ToolBeliefsList } from "./ToolBeliefsList";
export { ToolKnowledgeSearch } from "./ToolKnowledgeSearch";
export { ToolKnowledgeSources } from "./ToolKnowledgeSources";
export { ToolKnowledgeAction } from "./ToolKnowledgeAction";
export { ToolCurateMemory } from "./ToolCurateMemory";
export { ToolCuratorAction } from "./ToolCuratorAction";

interface ToolPart {
  type: string;
  state: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
}

/**
 * Maps a tool call part from AI SDK's message.parts[] to the appropriate
 * rich card component. Returns null for unknown tool types so callers
 * can optionally render a generic fallback.
 */
export function renderToolPart(part: ToolPart, key: string | number): ReactNode {
  const { type, state, input, output } = part;

  // Strip "tool-" prefix if present (AI SDK convention)
  const toolName = type.startsWith("tool-") ? type.slice(5) : type;

  switch (toolName) {
    case "web_search":
      return <ToolSearchResults key={key} state={state} input={input} output={output} />;

    case "task_list":
      return <ToolTaskList key={key} state={state} input={input} output={output} />;

    case "task_add":
    case "task_done":
      return (
        <ToolTaskAction
          key={key}
          state={state}
          toolName={toolName as "task_add" | "task_done"}
          input={input}
          output={output}
        />
      );

    case "memory_recall":
      return <ToolMemoryRecall key={key} state={state} input={input} output={output} />;

    case "memory_remember":
      return <ToolMemoryAction key={key} state={state} input={input} output={output} />;

    case "memory_beliefs":
      return <ToolBeliefsList key={key} state={state} input={input} output={output} />;

    case "memory_forget":
      return <ToolMemoryForget key={key} state={state} input={input} output={output} />;

    case "knowledge_search":
      return <ToolKnowledgeSearch key={key} state={state} input={input} output={output} />;

    case "knowledge_sources":
      return <ToolKnowledgeSources key={key} state={state} input={input} output={output} />;

    case "learn_from_url":
    case "knowledge_forget":
    case "knowledge_status":
    case "job_status":
      return (
        <ToolKnowledgeAction
          key={key}
          state={state}
          toolName={toolName as "learn_from_url" | "knowledge_forget" | "knowledge_status" | "job_status"}
          input={input}
          output={output}
        />
      );

    case "curate_memory":
      return <ToolCurateMemory key={key} state={state} input={input} output={output} />;

    case "fix_issues":
    case "list_beliefs":
      return (
        <ToolCuratorAction
          key={key}
          state={state}
          toolName={toolName as "fix_issues" | "list_beliefs"}
          input={input}
          output={output}
        />
      );

    default:
      // Generic JSON fallback for unknown tools
      return (
        <div
          key={key}
          className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
        >
          <div className="text-[10px] font-medium text-muted-foreground">
            Tool: {toolName} ({state})
          </div>
          {input && (
            <pre className="mt-1 max-h-24 overflow-auto text-[10px] text-muted-foreground">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
          {output && state === "output-available" && (
            <pre className="mt-1 max-h-24 overflow-auto text-[10px] text-foreground">
              {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
            </pre>
          )}
        </div>
      );
  }
}
