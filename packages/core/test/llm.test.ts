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

import { generateText, streamText, embed as aiEmbed } from "ai";
const mockGenerateText = vi.mocked(generateText);
const mockStreamText = vi.mocked(streamText);
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

  // --- Google provider tests ---

  it("should construct with google config", () => {
    const client = createLLMClient({
      provider: "google",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza-test",
    });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf("function");
    expect(client.health).toBeTypeOf("function");
    expect(client.embed).toBeTypeOf("function");
  });

  it("chat should return text and usage via google provider", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Google says hi",
      usage: { inputTokens: 15, outputTokens: 7 },
    } as any);

    const client = createLLMClient({
      provider: "google",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza-test",
    });

    const result = await client.chat([{ role: "user", content: "Hi" }]);
    expect(result.text).toBe("Google says hi");
    expect(result.usage.inputTokens).toBe(15);
    expect(result.usage.outputTokens).toBe(7);
    expect(result.usage.totalTokens).toBe(22);
  });

  it("health should return ok for google", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = mockFetch;
    const client = createLLMClient({
      provider: "google",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza-test",
    });
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("google");
    // Verify it calls the models endpoint with API key in header (not query string)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/models"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-goog-api-key": "AIza-test" }),
      }),
    );
  });

  it("embed should return embedding vector via google provider", async () => {
    mockEmbed.mockResolvedValue({
      embedding: [0.7, 0.8, 0.9],
      value: "test",
      usage: { tokens: 5 },
    } as any);

    const client = createLLMClient({
      provider: "google",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza-test",
    });

    const result = await client.embed("test text");
    expect(result.embedding).toEqual([0.7, 0.8, 0.9]);
    expect(mockEmbed).toHaveBeenCalledOnce();
  });

  // --- Error handling tests ---

  it("chat should throw human-readable error for invalid API key", async () => {
    mockGenerateText.mockRejectedValue(new Error("Invalid API key provided"));

    const client = createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-bad",
    });

    await expect(client.chat([{ role: "user", content: "Hi" }]))
      .rejects.toThrow("Invalid API key for openai");
  });

  it("chat should throw human-readable error for unreachable endpoint", async () => {
    mockGenerateText.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    const client = createLLMClient({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    });

    await expect(client.chat([{ role: "user", content: "Hi" }]))
      .rejects.toThrow("Cannot reach ollama");
  });

  it("chat should throw human-readable error for model not found", async () => {
    mockGenerateText.mockRejectedValue(new Error("Model not found: nonexistent-model"));

    const client = createLLMClient({
      provider: "openai",
      model: "nonexistent-model",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });

    await expect(client.chat([{ role: "user", content: "Hi" }]))
      .rejects.toThrow("Model not found for openai");
  });

  // --- streamChat tests ---

  function makeClient() {
    return createLLMClient({
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      fallbackMode: "strict",
    });
  }

  async function collectEvents(gen: AsyncGenerator<any>) {
    const events: any[] = [];
    for await (const e of gen) {
      events.push(e);
    }
    return events;
  }

  it("streamChat yields text-delta events", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Hello" };
        yield { type: "text-delta", text: " world" };
        yield { type: "finish", totalUsage: { inputTokens: 10, outputTokens: 5 } };
      })(),
    } as any);

    const client = makeClient();
    const events = await collectEvents(client.streamChat([{ role: "user", content: "Hi" }]));

    expect(events[0]).toEqual({ type: "text-delta", content: "Hello" });
    expect(events[1]).toEqual({ type: "text-delta", content: " world" });
    // Last event should be done with accumulated text
    const done = events.find((e: any) => e.type === "done");
    expect(done).toBeDefined();
    expect(done.text).toBe("Hello world");
  });

  it("streamChat yields tool-call and tool-result events", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "tool-call", toolName: "remember", input: { text: "fact" } };
        yield { type: "tool-result", toolName: "remember", output: { ok: true } };
        yield { type: "finish", totalUsage: { inputTokens: 20, outputTokens: 10 } };
      })(),
    } as any);

    const client = makeClient();
    const events = await collectEvents(client.streamChat([{ role: "user", content: "Hi" }]));

    const toolCall = events.find((e: any) => e.type === "tool-call");
    expect(toolCall).toEqual({ type: "tool-call", toolName: "remember", args: { text: "fact" } });

    const toolResult = events.find((e: any) => e.type === "tool-result");
    expect(toolResult).toEqual({ type: "tool-result", toolName: "remember", result: { ok: true } });
  });

  it("streamChat yields error event on stream error", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "partial" };
        yield { type: "error", error: new Error("fetch failed: ECONNREFUSED") };
        yield { type: "finish", totalUsage: { inputTokens: 5, outputTokens: 1 } };
      })(),
    } as any);

    const client = makeClient();
    const events = await collectEvents(client.streamChat([{ role: "user", content: "Hi" }]));

    const errorEvent = events.find((e: any) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain("Cannot reach openai");
  });

  it("streamChat yields done event with accumulated text and usage", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "A" };
        yield { type: "text-delta", text: "B" };
        yield { type: "text-delta", text: "C" };
        yield { type: "finish", totalUsage: { inputTokens: 100, outputTokens: 50 } };
      })(),
    } as any);

    const client = makeClient();
    const events = await collectEvents(client.streamChat([{ role: "user", content: "Hi" }]));

    const done = events[events.length - 1];
    expect(done.type).toBe("done");
    expect(done.text).toBe("ABC");
    expect(done.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("streamChat handles streamText throwing", async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error("Invalid API key provided");
    });

    const client = makeClient();
    const events = await collectEvents(client.streamChat([{ role: "user", content: "Hi" }]));

    // Should yield an error event then a done event
    const errorEvent = events.find((e: any) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toContain("Invalid API key for openai");

    // Should NOT yield a done event when streamText throws synchronously (returns early)
    const doneEvent = events.find((e: any) => e.type === "done");
    expect(doneEvent).toBeUndefined();
  });
});
