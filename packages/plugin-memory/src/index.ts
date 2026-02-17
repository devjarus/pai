import type { Plugin, PluginContext, Command } from "@personal-ai/core";
import { memoryMigrations, listEpisodes, listBeliefs, searchBeliefs, getMemoryContext, getBeliefHistory } from "./memory.js";
import { remember } from "./remember.js";

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
          console.log(`${label} belief (${result.beliefId})`);
        },
      },
      {
        name: "memory recall",
        description: "Search beliefs by text",
        args: [{ name: "query", description: "Search query", required: true }],
        async action(args) {
          const beliefs = searchBeliefs(ctx.storage, args["query"]!);
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
        name: "memory context",
        description: "Preview memory context for a query",
        args: [{ name: "query", description: "Search query to find relevant context", required: true }],
        async action(args) {
          const context = getMemoryContext(ctx.storage, args["query"]!);
          console.log(context);
        },
      },
    ];
  },
};

export { memoryMigrations, getMemoryContext } from "./memory.js";
