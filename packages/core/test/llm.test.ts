import { describe, it, expect, vi, afterEach } from "vitest";
import { createLLMClient } from "../src/llm.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "ai";
const mockGenerateText = vi.mocked(generateText);

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
});
