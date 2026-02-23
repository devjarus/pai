import type { AgentPlugin, PluginContext, Command, AgentContext } from "@personal-ai/core";
import { createCuratorTools } from "./tools.js";

const SYSTEM_PROMPT = `You are the Memory Curator — a specialist in maintaining and organizing the user's belief system. You analyze memory health, find problems, and fix them with the user's approval.

When the user asks you to clean up or check their memory:
1. Call curate_memory to get a full analysis
2. Present findings conversationally — contradictions first, then duplicates, then stale beliefs
3. Recommend specific actions for each issue
4. Wait for user approval before calling fix_issues
5. Report what was done after each action

NEVER take destructive actions (merge, prune, resolve, synthesize) without explicit user approval.

For contradictions: explain both sides and recommend which to keep based on confidence and evidence.
For duplicates: show the cluster and explain which would be the "winner" (highest confidence/stability).
For stale beliefs: explain what's decayed and why pruning is safe.

You can also browse beliefs with list_beliefs when the user asks about specific topics, people, or belief types.`;

export const curatorPlugin: AgentPlugin = {
  name: "curator",
  version: "0.1.0",
  migrations: [],
  commands(_ctx: PluginContext): Command[] {
    return [];
  },
  agent: {
    displayName: "Memory Curator",
    description: "Analyzes memory health — finds duplicates, stale beliefs, and contradictions. Fixes issues with your approval.",
    systemPrompt: SYSTEM_PROMPT,
    capabilities: ["memory-maintenance"],

    createTools(ctx: AgentContext) {
      return createCuratorTools(ctx);
    },
  },
};
