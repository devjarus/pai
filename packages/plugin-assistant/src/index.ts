import type { AgentPlugin, PluginContext, Command, AgentContext } from "@personal-ai/core";
import { createAgentTools } from "./tools.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { autoLearnUrls } from "./auto-memory.js";

export const assistantPlugin: AgentPlugin = {
  name: "assistant",
  version: "0.2.0",
  migrations: [],
  commands(_ctx: PluginContext): Command[] {
    return [];
  },
  agent: {
    displayName: "Personal Assistant",
    description: "General-purpose assistant with persistent memory, web search, and task management — uses tools to recall memories, search the web, and manage tasks on demand.",
    systemPrompt: SYSTEM_PROMPT,
    capabilities: ["general", "memory", "tasks", "web-search"],

    createTools(ctx: AgentContext) {
      return createAgentTools(ctx);
    },

    async afterResponse(ctx: AgentContext, _response: string) {
      autoLearnUrls(ctx, ctx.userMessage ?? "");
    },
  },
};
