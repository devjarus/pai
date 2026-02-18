import type { Plugin, PluginContext, Command } from "@personal-ai/core";
import { memoryMigrations, listEpisodes, listBeliefs, searchBeliefs, findSimilarBeliefs, getMemoryContext, getBeliefHistory, forgetBelief, pruneBeliefs, reflect } from "./memory.js";
import { remember } from "./remember.js";

function out(ctx: PluginContext, data: unknown, humanText: string): void {
  console.log(ctx.json ? JSON.stringify(data) : humanText);
}

export const memoryPlugin: Plugin = {
  name: "memory",
  version: "0.1.0",
  migrations: memoryMigrations,

  commands(ctx: PluginContext): Command[] {
    return [
      {
        name: "memory remember",
        description: "Record an observation and extract a belief",
        args: [{ name: "text", description: "What you observed or learned", required: true }],
        async action(args) {
          const result = await remember(ctx.storage, ctx.llm, args["text"]!, ctx.logger);
          const label = result.isReinforcement ? "Reinforced existing" : "New";
          out(ctx, result, `${label} belief(s): ${result.beliefIds.join(", ")}`);
        },
      },
      {
        name: "memory recall",
        description: "Search beliefs by text",
        args: [{ name: "query", description: "Search query", required: true }],
        async action(args) {
          const query = args["query"]!;
          let beliefs: Array<{ statement: string; confidence: number }> = [];
          try {
            const { embedding } = await ctx.llm.embed(query);
            const similar = findSimilarBeliefs(ctx.storage, embedding, 10);
            beliefs = similar.filter((s) => s.similarity > 0.3).map((s) => ({
              statement: s.statement,
              confidence: s.confidence,
            }));
          } catch {
            // Fallback to FTS5 if embedding fails
          }
          if (beliefs.length === 0) {
            beliefs = searchBeliefs(ctx.storage, query);
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
            console.log(`[${b.confidence.toFixed(1)}] ${b.statement}`);
          }
        },
      },
      {
        name: "memory beliefs",
        description: "List all active beliefs",
        options: [{ flags: "--status <status>", description: "Filter by status", defaultValue: "active" }],
        async action(_args, opts) {
          const beliefs = listBeliefs(ctx.storage, opts["status"]);
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
            console.log(`[${b.confidence.toFixed(1)}] ${b.statement}`);
          }
        },
      },
      {
        name: "memory episodes",
        description: "List recent episodes",
        options: [{ flags: "--limit <n>", description: "Max episodes", defaultValue: "20" }],
        async action(_args, opts) {
          const episodes = listEpisodes(ctx.storage, parseInt(opts["limit"] ?? "20", 10));
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
        async action() {
          const result = reflect(ctx.storage);
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
    ];
  },
};

export { memoryMigrations, getMemoryContext, findSimilarEpisodes, listBeliefs, searchBeliefs, findSimilarBeliefs, listEpisodes, getBeliefHistory, forgetBelief, pruneBeliefs, reflect } from "./memory.js";
export { remember } from "./remember.js";
