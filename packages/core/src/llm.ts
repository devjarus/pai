import { generateText, embed as aiEmbed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ai-sdk-ollama";
import type { LLMClient, ChatMessage, ChatOptions, ChatResult, Config, Logger } from "./types.js";
import { createLogger } from "./logger.js";

export function createLLMClient(llmConfig: Config["llm"], logger?: Logger): LLMClient {
  const log = logger ?? createLogger();
  const { provider, model, baseUrl, apiKey } = llmConfig;

  const llmModel =
    provider === "ollama"
      ? createOllama({ baseURL: baseUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined })(model)
      : createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" })(model);

  const embedModelName = llmConfig.embedModel ?? (provider === "ollama" ? "nomic-embed-text" : "text-embedding-3-small");
  const embeddingModel =
    provider === "ollama"
      ? createOllama({ baseURL: baseUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }).embeddingModel(embedModelName)
      : createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" }).textEmbeddingModel(embedModelName);

  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    log.debug("LLM chat request", { model, messageCount: messages.length });
    const { text, usage } = await generateText({
      model: llmModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens,
    });

    const result: ChatResult = {
      text,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
    };
    log.debug("LLM chat response", { responseLength: result.text.length, usage: result.usage });
    return result;
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
    } catch (err) {
      log.error("Health check failed", { provider, error: err instanceof Error ? err.message : String(err) });
      return { ok: false, provider };
    }
  }

  async function embed(text: string): Promise<{ embedding: number[] }> {
    log.debug("Embedding request", { model: embedModelName, textLength: text.length });
    const { embedding } = await aiEmbed({
      model: embeddingModel,
      value: text,
    });
    log.debug("Embedding response", { dimensions: embedding.length });
    return { embedding };
  }

  return { chat, embed, health };
}
