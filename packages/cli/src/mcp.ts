#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, createStorage, createLLMClient, createLogger } from "@personal-ai/core";
import {
  memoryMigrations,
  knowledgeMigrations,
  getMemoryContext,
  remember,
  listBeliefs,
  searchBeliefs,
  semanticSearch,
  forgetBelief,
  memoryStats,
  synthesize,
  learnFromContent,
  knowledgeSearch,
  listSources,
  forgetSource,
} from "@personal-ai/core";
import { fetchPageAsMarkdown } from "@personal-ai/plugin-assistant/page-fetch";
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
storage.migrate("knowledge", knowledgeMigrations);
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
  name: "pai",
  version: "0.1.0",
  description: "Persistent AI memory — belief lifecycle, semantic search, and tasks for coding agents",
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
      let beliefs: Array<{ id: string; statement: string; confidence: number; type: string }> = [];
      try {
        const { embedding } = await llm.embed(query);
        const similar = semanticSearch(storage, embedding, 10, query);
        beliefs = similar.filter((s) => s.similarity > 0.2).map((s) => ({
          id: s.beliefId,
          statement: s.statement,
          confidence: s.confidence,
          type: s.type ?? "insight",
        }));
      } catch {
        // Fallback to FTS5
      }
      if (beliefs.length === 0) {
        beliefs = searchBeliefs(storage, query).map((b) => ({
          id: b.id, statement: b.statement, confidence: b.confidence, type: b.type,
        }));
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

server.registerTool(
  "memory-stats",
  {
    description: "Get memory system statistics (belief counts, episode count, avg confidence).",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(memoryStats(storage));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "memory-synthesize",
  {
    description: "Generate meta-beliefs from clusters of related beliefs. Finds thematic groups and creates higher-level insights.",
    inputSchema: {},
  },
  async () => {
    try {
      const result = await synthesize(storage, llm);
      return ok(result);
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

// --- Knowledge tools ---

server.registerTool(
  "knowledge-learn",
  {
    description: "Learn from a web page — fetch, extract content, chunk, and store in the knowledge base. Returns source title and chunk count.",
    inputSchema: {
      url: z.string().url().describe("URL of the web page to learn from"),
    },
  },
  async ({ url }) => {
    try {
      const page = await fetchPageAsMarkdown(url);
      if (!page) return err(new Error("Could not extract content from URL. The page may require JavaScript or is not an article."));
      const result = await learnFromContent(storage, llm, url, page.title, page.markdown);
      if (result.skipped) return ok({ skipped: true, title: result.source.title });
      return ok({ title: result.source.title, chunks: result.chunksStored, url: result.source.url });
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "knowledge-search",
  {
    description: "Search the knowledge base for information learned from web pages. Returns matching content chunks with source attribution.",
    inputSchema: {
      query: z.string().describe("Search query"),
    },
  },
  async ({ query }) => {
    try {
      const results = await knowledgeSearch(storage, llm, query);
      return ok(results.map((r) => ({
        content: r.chunk.content.slice(0, 1000),
        source: r.source.title,
        url: r.source.url,
        relevance: Math.round(r.score * 100),
      })));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "knowledge-sources",
  {
    description: "List all URLs/pages that have been learned and stored in the knowledge base.",
    inputSchema: {},
  },
  async () => {
    try {
      const sources = listSources(storage);
      return ok(sources.map((s) => ({
        id: s.id.slice(0, 8),
        title: s.title,
        url: s.url,
        chunks: s.chunk_count,
        learnedAt: s.fetched_at,
      })));
    } catch (e) { return err(e); }
  },
);

server.registerTool(
  "knowledge-forget",
  {
    description: "Remove a learned source and all its chunks from the knowledge base by source ID or prefix.",
    inputSchema: {
      sourceId: z.string().describe("Source ID or prefix (8+ chars)"),
    },
  },
  async ({ sourceId }) => {
    try {
      const sources = listSources(storage);
      const match = sources.find((s) => s.id.startsWith(sourceId));
      if (!match) return err(new Error("Source not found"));
      forgetSource(storage, match.id);
      return ok({ ok: true, title: match.title, chunks: match.chunk_count });
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
