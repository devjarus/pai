import type { PluginContext, Command } from "../types.js";
import { readFileSync, writeFileSync } from "node:fs";
import {
  listEpisodes,
  listBeliefs,
  searchBeliefs,
  semanticSearch,
  getMemoryContext,
  getBeliefHistory,
  forgetBelief,
  pruneBeliefs,
  reflect,
  mergeDuplicates,
  synthesize,
  exportMemory,
  importMemory,
  memoryStats,
} from "./memory.js";
import { remember } from "./remember.js";
import { generateMemoryFile } from "./memory-file.js";
import { findGitRoot } from "../config.js";
import { join } from "node:path";

function resolveMemoryFilePath(): string | null {
  const gitRoot = findGitRoot(process.cwd());
  if (!gitRoot) return null;
  return join(gitRoot, ".claude", "memory.md");
}

function syncMemoryFile(ctx: PluginContext): void {
  const filePath = resolveMemoryFilePath();
  if (!filePath) return;
  try {
    generateMemoryFile(ctx.storage, filePath);
  } catch {
    ctx.logger?.warn("Failed to sync memory file");
  }
}

function out(ctx: PluginContext, data: unknown, humanText: string): void {
  console.log(ctx.json ? JSON.stringify(data) : humanText);
}

export function memoryCommands(ctx: PluginContext): Command[] {
  return [
    {
      name: "memory remember",
      description: "Record an observation and extract a belief",
      args: [{ name: "text", description: "What you observed or learned", required: true }],
      async action(args) {
        const result = await remember(ctx.storage, ctx.llm, args["text"]!, ctx.logger);
        syncMemoryFile(ctx);
        const label = result.isReinforcement ? "Reinforced existing" : "New";
        out(ctx, result, `${label} belief(s): ${result.beliefIds.join(", ")}`);
      },
    },
    {
      name: "memory recall",
      description: "Search beliefs by text",
      args: [{ name: "query", description: "Search query", required: true }],
      options: [{ flags: "--type <type>", description: "Filter by belief type (factual, preference, procedural, architectural, insight, meta)" }],
      async action(args, opts) {
        const query = args["query"]!;
        const typeFilter = opts?.["type"] as string | undefined;
        let beliefs: Array<{ id: string; statement: string; confidence: number; type: string }> = [];
        try {
          const { embedding } = await ctx.llm.embed(query);
          const similar = semanticSearch(ctx.storage, embedding, 10, query);
          beliefs = similar.filter((s) => s.similarity > 0.2).map((s) => ({
            id: s.beliefId,
            statement: s.statement,
            confidence: s.confidence,
            type: s.type ?? "insight",
          }));
        } catch {
          // Fallback to FTS5 if embedding fails
        }
        if (beliefs.length === 0) {
          beliefs = searchBeliefs(ctx.storage, query).map((b) => ({
            id: b.id,
            statement: b.statement,
            confidence: b.confidence,
            type: b.type,
          }));
        }
        if (typeFilter) {
          beliefs = beliefs.filter((b) => b.type === typeFilter);
        }
        if (beliefs.length === 0) ctx.exitCode = 2;
        if (ctx.json) {
          console.log(JSON.stringify(beliefs));
          return;
        }
        if (beliefs.length === 0) {
          console.log("No matching beliefs found.");
          return;
        }
        for (const b of beliefs) {
          console.log(`[${b.confidence.toFixed(1)}] (${b.type}) ${b.statement}`);
        }
      },
    },
    {
      name: "memory beliefs",
      description: "List all active beliefs",
      options: [
        { flags: "--status <status>", description: "Filter by status", defaultValue: "active" },
        { flags: "--type <type>", description: "Filter by belief type (factual, preference, procedural, architectural, insight, meta)" },
      ],
      async action(_args, opts) {
        let beliefs = listBeliefs(ctx.storage, opts["status"]);
        const typeFilter = opts["type"] as string | undefined;
        if (typeFilter) {
          beliefs = beliefs.filter((b) => b.type === typeFilter);
        }
        if (beliefs.length === 0) ctx.exitCode = 2;
        if (ctx.json) {
          console.log(JSON.stringify(beliefs));
          return;
        }
        if (beliefs.length === 0) {
          console.log("No beliefs found.");
          return;
        }
        for (const b of beliefs) {
          console.log(`[${b.confidence.toFixed(1)}] (${b.type}) ${b.statement}`);
        }
      },
    },
    {
      name: "memory episodes",
      description: "List recent episodes",
      options: [{ flags: "--limit <n>", description: "Max episodes", defaultValue: "20" }],
      async action(_args, opts) {
        const limit = parseInt(opts["limit"] ?? "20", 10);
        if (Number.isNaN(limit) || limit < 1) throw new Error(`Invalid limit: "${opts["limit"]}". Must be a positive number.`);
        const episodes = listEpisodes(ctx.storage, limit);
        if (episodes.length === 0) ctx.exitCode = 2;
        if (ctx.json) {
          console.log(JSON.stringify(episodes));
          return;
        }
        if (episodes.length === 0) {
          console.log("No episodes found.");
          return;
        }
        for (const ep of episodes) {
          console.log(`[${ep.timestamp}] ${ep.action}`);
        }
      },
    },
    {
      name: "memory history",
      description: "Show change history for a belief",
      args: [{ name: "beliefId", description: "Belief ID (or prefix)", required: true }],
      async action(args) {
        const history = getBeliefHistory(ctx.storage, args["beliefId"]!);
        if (history.length === 0) ctx.exitCode = 2;
        if (ctx.json) {
          console.log(JSON.stringify(history));
          return;
        }
        if (history.length === 0) {
          console.log("No history found for this belief.");
          return;
        }
        for (const h of history) {
          console.log(`[${h.created_at}] ${h.change_type}: ${h.detail ?? "(no detail)"}`);
        }
      },
    },
    {
      name: "memory forget",
      description: "Soft-delete a belief (sets status to 'forgotten')",
      args: [{ name: "beliefId", description: "Belief ID (or prefix)", required: true }],
      async action(args) {
        forgetBelief(ctx.storage, args["beliefId"]!);
        out(ctx, { ok: true }, "Belief forgotten.");
      },
    },
    {
      name: "memory prune",
      description: "Remove beliefs with effective confidence below threshold",
      options: [{ flags: "--threshold <n>", description: "Confidence threshold (default 0.05)", defaultValue: "0.05" }],
      async action(_args, opts) {
        const threshold = parseFloat(opts["threshold"] ?? "0.05");
        if (Number.isNaN(threshold)) throw new Error(`Invalid threshold: "${opts["threshold"]}". Must be a number.`);
        const pruned = pruneBeliefs(ctx.storage, threshold);
        if (ctx.json) {
          console.log(JSON.stringify({ pruned }));
          return;
        }
        if (pruned.length === 0) {
          console.log("No beliefs below threshold.");
        } else {
          console.log(`Pruned ${pruned.length} belief(s).`);
        }
      },
    },
    {
      name: "memory context",
      description: "Preview memory context for a query",
      args: [{ name: "query", description: "Search query to find relevant context", required: true }],
      async action(args) {
        const context = await getMemoryContext(ctx.storage, args["query"]!, { llm: ctx.llm });
        console.log(ctx.json ? JSON.stringify({ context }) : context);
      },
    },
    {
      name: "memory reflect",
      description: "Scan beliefs for near-duplicates and stale entries",
      options: [{ flags: "--merge", description: "Auto-merge duplicate clusters (keep highest confidence, invalidate rest)" }],
      async action(_args, opts) {
        const result = reflect(ctx.storage);
        const shouldMerge = opts?.["merge"] !== undefined;

        if (shouldMerge && result.duplicates.length > 0) {
          const mergeResult = mergeDuplicates(ctx.storage, result.duplicates);
          if (ctx.json) {
            console.log(JSON.stringify({ ...result, mergeResult }));
            return;
          }
          console.log(`${result.total} active beliefs scanned.`);
          console.log(`Merged ${mergeResult.merged} duplicate(s) into ${mergeResult.kept.length} belief(s).`);
          return;
        }

        if (ctx.json) {
          console.log(JSON.stringify(result));
          return;
        }
        console.log(`${result.total} active beliefs scanned.`);
        if (result.duplicates.length > 0) {
          console.log(`\n${result.duplicates.length} duplicate cluster(s):`);
          for (const d of result.duplicates) {
            console.log(`  Cluster (${d.ids.length} beliefs):`);
            for (let i = 0; i < d.ids.length; i++) {
              console.log(`    ${d.ids[i]!.slice(0, 8)}  ${d.statements[i]}`);
            }
          }
        } else {
          console.log("No duplicates found.");
        }
        if (result.stale.length > 0) {
          console.log(`\n${result.stale.length} stale belief(s) (confidence < 0.1):`);
          for (const s of result.stale) {
            console.log(`  ${s.id.slice(0, 8)}  [${s.effectiveConfidence.toFixed(3)}] ${s.statement}`);
          }
        } else {
          console.log("No stale beliefs.");
        }
      },
    },
    {
      name: "memory synthesize",
      description: "Generate meta-beliefs from belief clusters",
      async action() {
        const result = await synthesize(ctx.storage, ctx.llm);
        if (ctx.json) {
          console.log(JSON.stringify(result));
          return;
        }
        if (result.metaBeliefs.length === 0) {
          console.log("No belief clusters found for synthesis.");
          ctx.exitCode = 2;
          return;
        }
        console.log(`Synthesized ${result.metaBeliefs.length} meta-belief(s) from ${result.clustersProcessed} cluster(s):\n`);
        for (const mb of result.metaBeliefs) {
          console.log(`  [meta] ${mb}`);
        }
      },
    },
    {
      name: "memory stats",
      description: "Show memory system statistics",
      async action() {
        const stats = memoryStats(ctx.storage);
        if (ctx.json) {
          console.log(JSON.stringify(stats));
          return;
        }
        console.log(`Beliefs: ${stats.beliefs.active} active, ${stats.beliefs.invalidated} invalidated, ${stats.beliefs.forgotten} forgotten (${stats.beliefs.total} total)`);
        console.log(`Episodes: ${stats.episodes}`);
        console.log(`Avg confidence: ${stats.avgConfidence.toFixed(2)}`);
        if (stats.oldestBelief) console.log(`Oldest belief: ${stats.oldestBelief}`);
        if (stats.newestBelief) console.log(`Newest belief: ${stats.newestBelief}`);
      },
    },
    {
      name: "memory export",
      description: "Export all memory data to a JSON file",
      args: [{ name: "file", description: "Output file path (default: stdout)", required: false }],
      async action(args) {
        const data = exportMemory(ctx.storage);
        const json = JSON.stringify(data, null, 2);
        if (args["file"]) {
          writeFileSync(args["file"], json);
          out(ctx, { ok: true, file: args["file"] }, `Exported to ${args["file"]}`);
        } else {
          console.log(json);
        }
      },
    },
    {
      name: "memory import",
      description: "Import memory data from a JSON file (skips duplicates)",
      args: [{ name: "file", description: "Input file path", required: true }],
      async action(args) {
        const raw = readFileSync(args["file"]!, "utf-8");
        const data = JSON.parse(raw);
        const result = importMemory(ctx.storage, data);
        out(ctx, result, `Imported ${result.beliefs} belief(s) and ${result.episodes} episode(s).`);
      },
    },
    {
      name: "memory sync",
      description: "Regenerate .claude/memory.md from current beliefs",
      async action() {
        const filePath = resolveMemoryFilePath();
        if (!filePath) {
          console.log("No git root found — cannot determine .claude/memory.md location.");
          ctx.exitCode = 1;
          return;
        }
        const result = generateMemoryFile(ctx.storage, filePath);
        out(ctx, result, `Synced ${result.beliefCount} belief(s) to ${result.path}`);
      },
    },
  ];
}

// Public API
export { memoryMigrations, getMemoryContext, retrieveContext, listBeliefs, searchBeliefs, findSimilarBeliefs, semanticSearch, recordAccess, forgetBelief, memoryStats, countSupportingEpisodes, linkSupersession, linkBeliefs, getLinkedBeliefs, synthesize, mergeDuplicates, pruneBeliefs, reflect, backfillSubjects, findContradictions } from "./memory.js";
export { remember } from "./remember.js";
export { generateMemoryFile } from "./memory-file.js";
export { needsMemoryPreflight } from "./preflight.js";
export { consolidateConversation } from "./consolidate.js";

// Types
export type { Belief, Episode, BeliefChange, MemoryStats, MemoryExport, MemoryExportV1, MemoryExportV2, SimilarBelief, ReflectionResult, UnifiedRetrievalResult } from "./memory.js";
export type { ConsolidationResult } from "./consolidate.js";
