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
  addGoal,
  listGoals,
} from "@personal-ai/plugin-tasks";

const config = loadConfig();
const logger = createLogger(config.logLevel, { dir: config.dataDir });
const storage = createStorage(config.dataDir, logger);
const llm = createLLMClient(config.llm, logger);

// Run migrations
storage.migrate("memory", memoryMigrations);
storage.migrate("tasks", taskMigrations);

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
    const result = await remember(storage, llm, text, logger);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "recall",
  {
    description: "Search memory for beliefs matching a query. Uses semantic search with FTS5 fallback.",
    inputSchema: { query: z.string().describe("Search query") },
  },
  async ({ query }) => {
    let beliefs: Array<{ statement: string; confidence: number }> = [];
    try {
      const { embedding } = await llm.embed(query);
      const similar = findSimilarBeliefs(storage, embedding, 10);
      beliefs = similar.filter((s) => s.similarity > 0.3).map((s) => ({
        statement: s.statement,
        confidence: s.confidence,
      }));
    } catch {
      // Fallback
    }
    if (beliefs.length === 0) {
      beliefs = searchBeliefs(storage, query);
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(beliefs) }] };
  },
);

server.registerTool(
  "memory-context",
  {
    description: "Get formatted memory context (beliefs + episodes) for a topic. Useful for injecting into LLM prompts.",
    inputSchema: { query: z.string().describe("Topic to get context for") },
  },
  async ({ query }) => {
    const context = await getMemoryContext(storage, query, { llm });
    return { content: [{ type: "text" as const, text: context }] };
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
    const beliefs = listBeliefs(storage, status);
    return { content: [{ type: "text" as const, text: JSON.stringify(beliefs) }] };
  },
);

server.registerTool(
  "forget",
  {
    description: "Soft-delete a belief by ID or prefix.",
    inputSchema: { beliefId: z.string().describe("Belief ID or prefix (8+ chars)") },
  },
  async ({ beliefId }) => {
    forgetBelief(storage, beliefId);
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
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
    const tasks = listTasks(storage, status);
    return { content: [{ type: "text" as const, text: JSON.stringify(tasks) }] };
  },
);

server.registerTool(
  "task-add",
  {
    description: "Create a new task.",
    inputSchema: {
      title: z.string().describe("Task title"),
      priority: z.enum(["low", "medium", "high"]).default("medium").describe("Priority level"),
      due: z.string().optional().describe("Due date (YYYY-MM-DD)"),
    },
  },
  async ({ title, priority, due }) => {
    const task = addTask(storage, { title, priority, dueDate: due });
    return { content: [{ type: "text" as const, text: JSON.stringify(task) }] };
  },
);

server.registerTool(
  "task-done",
  {
    description: "Mark a task as complete by ID or prefix.",
    inputSchema: { id: z.string().describe("Task ID or prefix (8+ chars)") },
  },
  async ({ id }) => {
    completeTask(storage, id);
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
  },
);

server.registerTool(
  "goal-list",
  {
    description: "List all active goals.",
    inputSchema: {},
  },
  async () => {
    const goals = listGoals(storage);
    return { content: [{ type: "text" as const, text: JSON.stringify(goals) }] };
  },
);

server.registerTool(
  "goal-add",
  {
    description: "Create a new goal.",
    inputSchema: { title: z.string().describe("Goal title") },
  },
  async ({ title }) => {
    const goal = addGoal(storage, { title });
    return { content: [{ type: "text" as const, text: JSON.stringify(goal) }] };
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
