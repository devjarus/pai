#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, createStorage, createLLMClient, createLogger } from "@personal-ai/core";
import {
  memoryMigrations,
  getMemoryContext,
  remember,
  listBeliefs,
  searchBeliefs,
  findSimilarBeliefs,
  forgetBelief,
} from "@personal-ai/plugin-memory";
import {
  taskMigrations,
  addTask,
  listTasks,
  completeTask,
  editTask,
  reopenTask,
  addGoal,
  listGoals,
  completeGoal,
} from "@personal-ai/plugin-tasks";

const config = loadConfig();
const logger = createLogger(config.logLevel, { dir: config.dataDir });
const storage = createStorage(config.dataDir, logger);
const llm = createLLMClient(config.llm, logger);

// Run migrations
storage.migrate("memory", memoryMigrations);
storage.migrate("tasks", taskMigrations);

// Clean shutdown
function shutdown(): void {
  storage.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function err(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
}

const server = new McpServer({
  name: "personal-ai",
  version: "0.1.0",
  description: "Local-first personal AI — memory and task management",
});

// --- Memory tools ---

server.registerTool(
  "remember",
  {
    description: "Store an observation and extract beliefs from it. Returns episode and belief IDs.",
    inputSchema: { text: z.string().describe("What you observed or learned") },
  },
  async ({ text }) => {
    try {
      const result = await remember(storage, llm, text, logger);
      return ok(result);
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "recall",
  {
    description: "Search memory for beliefs matching a query. Uses semantic search with FTS5 fallback.",
    inputSchema: { query: z.string().describe("Search query") },
  },
  async ({ query }) => {
    try {
      let beliefs: Array<{ statement: string; confidence: number }> = [];
      try {
        const { embedding } = await llm.embed(query);
        const similar = findSimilarBeliefs(storage, embedding, 10);
        beliefs = similar.filter((s) => s.similarity > 0.3).map((s) => ({
          statement: s.statement,
          confidence: s.confidence,
        }));
      } catch {
        // Fallback to FTS5
      }
      if (beliefs.length === 0) {
        beliefs = searchBeliefs(storage, query);
      }
      return ok(beliefs);
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "memory-context",
  {
    description: "Get formatted memory context (beliefs + episodes) for a topic. Useful for injecting into LLM prompts.",
    inputSchema: { query: z.string().describe("Topic to get context for") },
  },
  async ({ query }) => {
    try {
      const context = await getMemoryContext(storage, query, { llm });
      return ok({ context });
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "beliefs",
  {
    description: "List all beliefs with a given status. Returns array of belief objects.",
    inputSchema: {
      status: z.string().default("active").describe("Filter: active, invalidated, forgotten, pruned"),
    },
  },
  async ({ status }) => {
    try {
      return ok(listBeliefs(storage, status));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "forget",
  {
    description: "Soft-delete a belief by ID or prefix.",
    inputSchema: { beliefId: z.string().describe("Belief ID or prefix (8+ chars)") },
  },
  async ({ beliefId }) => {
    try {
      forgetBelief(storage, beliefId);
      return ok({ ok: true });
    } catch (e) { return err(e); }
  },
);

// --- Task tools ---

server.registerTool(
  "task-list",
  {
    description: "List tasks. Default: open tasks sorted by priority.",
    inputSchema: {
      status: z.enum(["open", "done", "all"]).default("open").describe("Filter by status"),
    },
  },
  async ({ status }) => {
    try {
      return ok(listTasks(storage, status));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "task-add",
  {
    description: "Create a new task.",
    inputSchema: {
      title: z.string().min(1).describe("Task title"),
      priority: z.enum(["low", "medium", "high"]).default("medium").describe("Priority level"),
      due: z.string().optional().describe("Due date (YYYY-MM-DD)"),
    },
  },
  async ({ title, priority, due }) => {
    try {
      return ok(addTask(storage, { title, priority, dueDate: due }));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "task-done",
  {
    description: "Mark a task as complete by ID or prefix.",
    inputSchema: { id: z.string().describe("Task ID or prefix (8+ chars)") },
  },
  async ({ id }) => {
    try {
      completeTask(storage, id);
      return ok({ ok: true });
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "task-edit",
  {
    description: "Edit an open task's title, priority, or due date.",
    inputSchema: {
      id: z.string().describe("Task ID or prefix (8+ chars)"),
      title: z.string().optional().describe("New title"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
      due: z.string().optional().describe("New due date (YYYY-MM-DD), or empty string to clear"),
    },
  },
  async ({ id, title, priority, due }) => {
    try {
      editTask(storage, id, { title, priority, dueDate: due });
      return ok({ ok: true });
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "task-reopen",
  {
    description: "Reopen a completed task.",
    inputSchema: { id: z.string().describe("Task ID or prefix (8+ chars)") },
  },
  async ({ id }) => {
    try {
      reopenTask(storage, id);
      return ok({ ok: true });
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "goal-list",
  {
    description: "List all active goals.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(listGoals(storage));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "goal-add",
  {
    description: "Create a new goal.",
    inputSchema: { title: z.string().min(1).describe("Goal title") },
  },
  async ({ title }) => {
    try {
      return ok(addGoal(storage, { title }));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "goal-done",
  {
    description: "Mark a goal as complete by ID or prefix.",
    inputSchema: { id: z.string().describe("Goal ID or prefix (8+ chars)") },
  },
  async ({ id }) => {
    try {
      completeGoal(storage, id);
      return ok({ ok: true });
    } catch (e) { return err(e); }
  },
);

// --- Start server ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server started on stdio");
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
