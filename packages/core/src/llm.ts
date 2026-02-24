import { generateText, streamText, embed as aiEmbed, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";
import type { LLMClient, ChatMessage, ChatOptions, ChatResult, StreamEvent, Config, Logger } from "./types.js";
import { createLogger } from "./logger.js";

/** Map raw provider/API errors to human-readable messages. */
function humanizeError(provider: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Invalid API key patterns
  if (lower.includes("invalid api key") || lower.includes("incorrect api key") ||
      lower.includes("authentication") || lower.includes("unauthorized") ||
      lower.includes("401") || lower.includes("invalid x-api-key")) {
    return `Invalid API key for ${provider}. Please check your API key in Settings.`;
  }

  // Model not found
  if (lower.includes("model not found") || lower.includes("does not exist") ||
      lower.includes("404") || lower.includes("no such model") ||
      lower.includes("model_not_found") || lower.includes("not found model")) {
    return `Model not found for ${provider}. Please verify the model name in Settings.`;
  }

  // Unreachable endpoint / connection errors
  if (lower.includes("econnrefused") || lower.includes("enotfound") ||
      lower.includes("fetch failed") || lower.includes("network") ||
      lower.includes("econnreset") || lower.includes("etimedout") ||
      lower.includes("unable to connect")) {
    return `Cannot reach ${provider} at the configured URL. Is the service running?`;
  }

  // Rate limiting
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return `Rate limited by ${provider}. Please wait a moment and try again.`;
  }

  // Quota / billing
  if (lower.includes("quota") || lower.includes("billing") || lower.includes("insufficient") || lower.includes("402")) {
    return `${provider} quota or billing issue. Please check your account.`;
  }

  // Fallback: return original message with provider context
  return `${provider} error: ${msg}`;
}

function createProviderModel(provider: Config["llm"]["provider"], model: string, baseUrl: string, apiKey?: string) {
  switch (provider) {
    case "ollama":
      return createOllama({ baseURL: baseUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined })(model);
    case "anthropic":
      return createAnthropic({ baseURL: baseUrl, apiKey: apiKey ?? "" })(model);
    case "google":
      return createGoogleGenerativeAI({ baseURL: baseUrl, apiKey: apiKey ?? "" })(model);
    case "openai":
    default:
      return createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" })(model);
  }
}

function createProviderEmbedding(provider: string, embedModelName: string, baseUrl: string, apiKey?: string) {
  switch (provider) {
    case "ollama":
      return createOllama({ baseURL: baseUrl, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }).embeddingModel(embedModelName);
    case "openai":
      return createOpenAI({ baseURL: baseUrl, apiKey: apiKey ?? "" }).textEmbeddingModel(embedModelName);
    case "google":
      return createGoogleGenerativeAI({ baseURL: baseUrl, apiKey: apiKey ?? "" }).textEmbeddingModel(embedModelName);
    case "anthropic":
      // Anthropic does not offer a native embedding API; return null to trigger local fallback
      return null;
    default:
      return null;
  }
}

// --- Local embedding via @huggingface/transformers (optional dependency) ---

let localPipeline: ((text: string) => Promise<number[]>) | null = null;
let localPipelineLoading: Promise<void> | null = null;

async function initLocalPipeline(log: Logger): Promise<void> {
  if (localPipeline) return;
  if (localPipelineLoading) { await localPipelineLoading; return; }

  localPipelineLoading = (async () => {
    try {
      // Dynamic import — package is optional
      const { pipeline, env } = await import("@huggingface/transformers");
      // Disable remote model fetching warnings in CI
      (env as Record<string, unknown>).allowRemoteModels = true;
      log.info("Loading local embedding model (all-MiniLM-L6-v2)...");
      const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        dtype: "fp32",
      });
      localPipeline = async (text: string): Promise<number[]> => {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        return Array.from(output.data as Float32Array);
      };
      log.info("Local embedding model loaded", { model: "all-MiniLM-L6-v2", dimensions: 384 });
    } catch (err) {
      log.warn("Local embedding unavailable — @huggingface/transformers not installed", {
        error: err instanceof Error ? err.message : String(err),
      });
      localPipeline = null;
    }
  })();
  await localPipelineLoading;
}

async function localEmbed(text: string, log: Logger): Promise<number[] | null> {
  await initLocalPipeline(log);
  if (!localPipeline) return null;
  return localPipeline(text);
}

// --- Main factory ---

export function createLLMClient(llmConfig: Config["llm"], logger?: Logger): LLMClient {
  const log = logger ?? createLogger();
  const { provider, model, baseUrl, apiKey } = llmConfig;
  const embedProviderSetting = llmConfig.embedProvider ?? "auto";

  const llmModel = createProviderModel(provider, model, baseUrl, apiKey);

  // Determine which provider to use for embeddings
  const effectiveEmbedProvider = embedProviderSetting === "auto" ? provider : embedProviderSetting;
  const defaultEmbedModels: Record<string, string> = {
    ollama: "nomic-embed-text",
    openai: "text-embedding-3-small",
    google: "text-embedding-004",
  };
  const defaultEmbedModel = defaultEmbedModels[effectiveEmbedProvider] ?? "text-embedding-3-small";
  const embedModelName = llmConfig.embedModel ?? defaultEmbedModel;

  // Only create a remote embedding model if the provider supports it
  const remoteEmbeddingModel =
    effectiveEmbedProvider !== "local"
      ? createProviderEmbedding(effectiveEmbedProvider, embedModelName, baseUrl, apiKey)
      : null;

  async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    log.debug("LLM chat request", { model, messageCount: messages.length });
    try {
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
    } catch (err) {
      const friendly = humanizeError(provider, err);
      log.error("LLM chat failed", { provider, model, error: friendly });
      throw new Error(friendly);
    }
  }

  async function* streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamEvent> {
    log.debug("LLM streamChat request", { model, messageCount: messages.length, hasTools: !!options?.tools });

    let result: ReturnType<typeof streamText>;
    try {
      result = streamText({
        model: llmModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: options?.tools as any,
        toolChoice: options?.toolChoice,
        stopWhen: options?.maxSteps ? stepCountIs(options.maxSteps) : undefined,
      });
    } catch (err) {
      const friendly = humanizeError(provider, err);
      log.error("LLM streamChat failed to start", { provider, model, error: friendly });
      yield { type: "error", error: friendly };
      return;
    }

    let fullText = "";
    let lastUsage: { inputTokens?: number; outputTokens?: number } = {};

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            fullText += part.text;
            yield { type: "text-delta", content: part.text };
            break;
          case "tool-call":
            log.debug("Tool call", { toolName: part.toolName });
            yield { type: "tool-call", toolName: part.toolName, args: (part as Record<string, unknown>).input as Record<string, unknown> ?? {} };
            break;
          case "tool-result":
            log.debug("Tool result", { toolName: part.toolName });
            yield { type: "tool-result", toolName: part.toolName, result: (part as Record<string, unknown>).output };
            break;
          case "tool-error" as string:
            log.warn("Tool error", { toolName: (part as Record<string, unknown>).toolName });
            // Emit as tool-result with error so the UI can clear the spinner
            yield { type: "tool-result", toolName: (part as Record<string, unknown>).toolName as string, result: { error: "Tool execution failed" } };
            break;
          case "error":
            yield { type: "error", error: humanizeError(provider, part.error) };
            break;
          case "finish": {
            // Track usage from the last finish event (fires per step in multi-step)
            const u = part.totalUsage;
            lastUsage = { inputTokens: u?.inputTokens, outputTokens: u?.outputTokens };
            break;
          }
        }
      }
    } catch (err) {
      const friendly = humanizeError(provider, err);
      log.error("LLM stream error", { provider, error: friendly });
      yield { type: "error", error: friendly };
    }

    // Yield done once after the stream ends with accumulated text
    yield {
      type: "done",
      text: fullText,
      usage: {
        inputTokens: lastUsage.inputTokens,
        outputTokens: lastUsage.outputTokens,
        totalTokens: (lastUsage.inputTokens ?? 0) + (lastUsage.outputTokens ?? 0),
      },
    };
  }

  async function health(): Promise<{ ok: boolean; provider: string }> {
    try {
      if (provider === "ollama") {
        const headers: Record<string, string> = {};
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        const res = await fetch(`${baseUrl}/api/tags`, { headers });
        return { ok: res.ok, provider: "ollama" };
      }
      if (provider === "anthropic") {
        const url = baseUrl.replace(/\/+$/, "") + "/v1/models";
        const res = await fetch(url, {
          headers: { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
        });
        return { ok: res.ok, provider: "anthropic" };
      }
      if (provider === "google") {
        // Google AI: list models endpoint to verify connectivity + API key
        const url = baseUrl.replace(/\/+$/, "") + "/models";
        const res = await fetch(url, {
          headers: { "x-goog-api-key": apiKey ?? "" },
        });
        return { ok: res.ok, provider: "google" };
      }
      // openai (default)
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
    // Fallback chain: remote provider → local → throw
    const useLocal = effectiveEmbedProvider === "local";

    if (!useLocal && remoteEmbeddingModel) {
      try {
        log.debug("Embedding request (remote)", { provider: effectiveEmbedProvider, model: embedModelName, textLength: text.length });
        const { embedding } = await aiEmbed({
          model: remoteEmbeddingModel,
          value: text,
        });
        log.debug("Embedding response (remote)", { dimensions: embedding.length });
        return { embedding };
      } catch (err) {
        // If embedProvider is explicitly set (not auto), don't fall back
        if (embedProviderSetting !== "auto") {
          const friendly = humanizeError(effectiveEmbedProvider, err);
          throw new Error(friendly);
        }
        log.warn("Remote embedding failed, trying local fallback", {
          provider: effectiveEmbedProvider,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Local embedding fallback (or primary when embedProvider === "local")
    const localResult = await localEmbed(text, log);
    if (localResult) {
      log.debug("Embedding response (local)", { dimensions: localResult.length });
      return { embedding: localResult };
    }

    throw new Error("Embedding unavailable: no remote provider and local embeddings not installed. Install @huggingface/transformers for local embeddings.");
  }

  return { chat, streamChat, embed, health, getModel: () => llmModel };
}
