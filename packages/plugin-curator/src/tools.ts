import { tool } from "ai";
import { z } from "zod";
import type { AgentContext } from "@personal-ai/core";
import {
  memoryStats,
  reflect,
  findContradictions,
  mergeDuplicates,
  pruneBeliefs,
  synthesize,
  forgetBelief,
  listBeliefs,
} from "@personal-ai/core";

export function createCuratorTools(ctx: AgentContext) {
  return {
    curate_memory: tool({
      description:
        "Analyze memory health: get stats, find duplicates, stale beliefs, and contradictions. Always call this first to understand the current state of memory.",
      inputSchema: z.object({}),
      execute: async () => {
        const stats = memoryStats(ctx.storage);
        const reflection = reflect(ctx.storage);
        const contradictions = await findContradictions(ctx.storage, ctx.llm);

        return {
          stats,
          duplicates: reflection.duplicates,
          stale: reflection.stale,
          contradictions: contradictions.map((c) => ({
            beliefA: { id: c.beliefA.id, statement: c.beliefA.statement, confidence: c.beliefA.confidence, subject: c.beliefA.subject },
            beliefB: { id: c.beliefB.id, statement: c.beliefB.statement, confidence: c.beliefB.confidence, subject: c.beliefB.subject },
            explanation: c.explanation,
          })),
          summary: `${stats.beliefs.active} active beliefs. ${reflection.duplicates.length} duplicate clusters. ${reflection.stale.length} stale beliefs. ${contradictions.length} contradictions.`,
        };
      },
    }),

    fix_issues: tool({
      description:
        "Fix memory issues. Actions: 'merge' (merge duplicate cluster), 'prune' (remove stale beliefs), 'resolve' (pick winner in contradiction), 'synthesize' (generate meta-beliefs from patterns). ONLY call after presenting findings and getting user approval.",
      inputSchema: z.object({
        action: z.enum(["merge", "prune", "resolve", "synthesize"]).describe("What to fix"),
        beliefIds: z.array(z.string()).optional().describe("For merge: IDs in the duplicate cluster"),
        threshold: z.number().optional().describe("For prune: confidence threshold (default 0.05)"),
        keepId: z.string().optional().describe("For resolve: ID of the belief to keep"),
        removeId: z.string().optional().describe("For resolve: ID of the belief to remove"),
      }),
      execute: async ({ action, beliefIds, threshold, keepId, removeId }) => {
        switch (action) {
          case "merge": {
            if (!beliefIds || beliefIds.length < 2) {
              return { ok: false, error: "Provide at least 2 belief IDs to merge" };
            }
            const cluster = [{ ids: beliefIds, statements: [], similarity: 0 }];
            const result = mergeDuplicates(ctx.storage, cluster);
            return { ok: true, message: `Merged ${result.merged} beliefs. Kept: ${result.kept.join(", ")}` };
          }
          case "prune": {
            const pruned = pruneBeliefs(ctx.storage, threshold ?? 0.05);
            return { ok: true, message: `Pruned ${pruned.length} stale beliefs.`, prunedIds: pruned };
          }
          case "resolve": {
            if (!keepId || !removeId) {
              return { ok: false, error: "Provide both keepId and removeId" };
            }
            forgetBelief(ctx.storage, removeId);
            return { ok: true, message: `Kept belief ${keepId.slice(0, 8)}, removed ${removeId.slice(0, 8)}.` };
          }
          case "synthesize": {
            const result = await synthesize(ctx.storage, ctx.llm);
            return { ok: true, message: `Generated ${result.metaBeliefs.length} meta-beliefs from ${result.clustersProcessed} clusters.`, metaBeliefs: result.metaBeliefs };
          }
        }
      },
    }),

    list_beliefs: tool({
      description: "Browse beliefs with optional filters. Use to inspect specific beliefs the user asks about.",
      inputSchema: z.object({
        status: z.enum(["active", "forgotten", "invalidated", "pruned"]).default("active").describe("Filter by status"),
        type: z.string().optional().describe("Filter by type: factual, preference, procedural, architectural, insight, meta"),
        subject: z.string().optional().describe("Filter by subject: owner, or a person's name"),
        limit: z.number().default(20).describe("Max results"),
      }),
      execute: async ({ status, type, subject, limit }) => {
        let beliefs = listBeliefs(ctx.storage, status);
        if (type) beliefs = beliefs.filter((b) => b.type === type);
        if (subject) beliefs = beliefs.filter((b) => b.subject === subject);
        return beliefs.slice(0, limit).map((b) => ({
          id: b.id.slice(0, 8),
          type: b.type,
          subject: b.subject,
          statement: b.statement,
          confidence: Math.round(b.confidence * 100) + "%",
          status: b.status,
        }));
      },
    }),
  };
}
