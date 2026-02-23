import { describe, it, expect, vi, afterEach } from "vitest";
import { createLLMClient } from "../src/llm.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  embed: vi.fn(),
  stepCountIs: vi.fn().mockReturnValue({ type: "step-count" }),
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue({ data: new Float32Array(384).fill(0.1) }),
  ),
  env: {},
}));

import { generateText, embed as aiEmbed } from "ai";
const mockGenerateText = vi.mocked(generateText);
const mockEmbed = vi.mocked(aiEmbed);

describe("LLMClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should construct with ollama config", () => {
    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf("function");
    expect(client.streamChat).toBeTypeOf("function");
    expect(client.health).toBeTypeOf("function");
  });

  it("should construct with openai config", () => {
    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });
    expect(client).toBeDefined();
  });

  it("chat should return text and usage via openai provider", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Hello world",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as any);

    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Hello world");
    expect(result.usage).toBeDefined();
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
  });

  it("chat should return text and usage via ollama provider", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Ollama says hi",
      usage: { inputTokens: 8, outputTokens: 4 },
    } as any);

    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Ollama says hi");
    expect(result.usage).toBeDefined();
    expect(result.usage.inputTokens).toBe(8);
    expect(result.usage.outputTokens).toBe(4);
    expect(result.usage.totalTokens).toBe(12);
  });

  it("chat should pass temperature and maxTokens to generateText", async () => {
    mockGenerateText.mockResolvedValue({
      text: "response",
      usage: { inputTokens: 5, outputTokens: 3 },
    } as any);

    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });

    await client.chat(
      [{ role: "user", content: "Hi" }],
      { temperature: 0.3, maxTokens: 100 },
    );

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.3,
        maxOutputTokens: 100,
      }),
    );
  });

  it("health should return ok for openai", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai");
  });

  it("health should return ok for ollama", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("ollama");
  });

  it("embed should return embedding vector via ollama provider", async () => {
    mockEmbed.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      value: "test",
      usage: { tokens: 5 },
    } as any);

    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });

    const result = await client.embed("test text");
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbed).toHaveBeenCalledOnce();
  });

  it("embed should return embedding vector via openai provider", async () => {
    mockEmbed.mockResolvedValue({
      embedding: [0.4, 0.5, 0.6],
      value: "test",
      usage: { tokens: 5 },
    } as any);

    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });

    const result = await client.embed("test text");
    expect(result.embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("health should return not ok on fetch failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      fallbackMode: "local-first",
    });
    const result = await client.health();
    expect(result.ok).toBe(false);
  });

  it("should construct with anthropic config", () => {
    const client = createLLMClient({
      provider: "anthropic",
      model: "claude-opus-4-6",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      fallbackMode: "strict",
    });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf("function");
    expect(client.health).toBeTypeOf("function");
    expect(client.embed).toBeTypeOf("function");
  });

  it("chat should return text and usage via anthropic provider", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Anthropic says hi",
      usage: { inputTokens: 12, outputTokens: 6 },
    } as any);

    const client = createLLMClient({
      provider: "anthropic",
      model: "claude-opus-4-6",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      fallbackMode: "strict",
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Anthropic says hi");
    expect(result.usage).toBeDefined();
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(6);
    expect(result.usage.totalTokens).toBe(18);
  });

  it("health should return ok for anthropic", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = mockFetch;
    const client = createLLMClient({
      provider: "anthropic",
      model: "claude-opus-4-6",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      fallbackMode: "strict",
    });
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("anthropic");
    // Verify it calls the right endpoint with x-api-key header
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "sk-ant-test" }),
      }),
    );
  });

  it("embed should use local fallback for anthropic provider (no native embeddings)", async () => {
    const client = createLLMClient({
      provider: "anthropic",
      model: "claude-opus-4-6",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      fallbackMode: "strict",
    });

    // Anthropic has no native embeddings, so with embedProvider=auto it falls back to local
    // Local embeddings are available since @huggingface/transformers is installed
    const result = await client.embed("test text");
    expect(result.embedding).toBeInstanceOf(Array);
    expect(result.embedding.length).toBe(384); // all-MiniLM-L6-v2 dimensions
    // Remote mock should NOT have been called (no OpenAI fallback with Anthropic key)
    expect(mockEmbed).not.toHaveBeenCalled();
  });
});
