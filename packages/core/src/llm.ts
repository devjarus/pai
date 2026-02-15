import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ai-sdk-ollama";
import type { LLMClient, ChatMessage, ChatOptions, ChatResult, Config } from "./types.js";

export function createLLMClient(llmConfig: Config["llm"]): LLMClient {
  const { provider, model, baseUrl, apiKey } = llmConfig;

  const llmModel =
    provider === "ollama"
      ? createOllama({ baseURL: baseUrl })(model)
      : createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" })(model);

  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    const { text, usage } = await generateText({
      model: llmModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens,
    });

    return {
      text,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
    };
  }

  async function health(): Promise<{ ok: boolean; provider: string }> {
    try {
      if (provider === "ollama") {
        const res = await fetch(`${baseUrl}/api/tags`);
        return { ok: res.ok, provider: "ollama" };
      }
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: res.ok, provider: "openai" };
    } catch {
      return { ok: false, provider };
    }
  }

  return { chat, health };
}
