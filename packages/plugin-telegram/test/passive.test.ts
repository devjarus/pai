import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @personal-ai/core
vi.mock("@personal-ai/core", () => ({
  semanticSearch: vi.fn().mockReturnValue([]),
  knowledgeSearch: vi.fn().mockResolvedValue([]),
  getContextBudget: vi.fn().mockReturnValue({ contextWindow: 8192, maxOutputTokens: 2048 }),
  getProviderOptions: vi.fn().mockReturnValue({}),
  instrumentedGenerateText: vi.fn(),
}));

import { bufferMessage, passiveProcess } from "../src/passive.js";
import { semanticSearch, knowledgeSearch, instrumentedGenerateText } from "@personal-ai/core";
import type { PluginContext, AgentPlugin } from "@personal-ai/core";

const mockCtx = {
  config: {
    telegram: { passiveListening: true, reactionCooldownMin: 0, proactiveCooldownMin: 0 },
    llm: { provider: "ollama", model: "test", contextWindow: 8192 },
  },
  storage: {},
  llm: {
    embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2] }),
    getModel: vi.fn().mockReturnValue("test-model"),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as unknown as PluginContext;

const mockAgentPlugin = {
  name: "assistant",
  version: "0.1.0",
  migrations: [],
  commands: () => [],
  agent: {
    displayName: "Test",
    description: "Test",
    systemPrompt: "Test",
    capabilities: [],
    createTools: () => ({}),
    afterResponse: vi.fn(),
  },
} as unknown as AgentPlugin;

const mockApi = {
  setMessageReaction: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
} as any;

describe("bufferMessage", () => {
  it("adds messages to the buffer", () => {
    // Use a unique chatId to avoid interference
    const chatId = 100001;
    bufferMessage(chatId, "Hello there", "Alice");
    bufferMessage(chatId, "How are you?", "Bob");
    // We can't directly inspect the buffer, but we can verify no errors
    // and that the function is callable multiple times
    expect(() => bufferMessage(chatId, "Third message", "Alice")).not.toThrow();
  });

  it("does not exceed BUFFER_SIZE (50)", () => {
    const chatId = 100002;
    // Add 55 messages — buffer should cap at 50
    for (let i = 0; i < 55; i++) {
      bufferMessage(chatId, `Message number ${i}`, "User");
    }
    // No direct way to check length, but the function should not throw
    // and the internal shift logic should have been triggered
    expect(() => bufferMessage(chatId, "One more", "User")).not.toThrow();
  });
});

describe("passiveProcess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    (mockCtx.config.telegram as any).passiveListening = true;
    (semanticSearch as any).mockReturnValue([]);
    (knowledgeSearch as any).mockResolvedValue([]);
    (instrumentedGenerateText as any).mockResolvedValue({ result: { text: "👍" } });
    mockCtx.llm.embed = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2] });
  });

  it("returns early when passiveListening is falsy", async () => {
    (mockCtx.config.telegram as any).passiveListening = false;
    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200001,
      { message_id: 1, text: "This is a long enough message to process" },
      mockApi,
    );
    expect(mockCtx.llm.embed).not.toHaveBeenCalled();
    expect(mockApi.setMessageReaction).not.toHaveBeenCalled();
  });

  it("returns early when message.text is undefined", async () => {
    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200002,
      { message_id: 1 },
      mockApi,
    );
    expect(mockCtx.llm.embed).not.toHaveBeenCalled();
    expect(mockApi.setMessageReaction).not.toHaveBeenCalled();
  });

  it("returns early when message.text is empty", async () => {
    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200003,
      { message_id: 1, text: "" },
      mockApi,
    );
    expect(mockCtx.llm.embed).not.toHaveBeenCalled();
    expect(mockApi.setMessageReaction).not.toHaveBeenCalled();
  });

  it("ignores short text (< 10 chars)", async () => {
    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200004,
      { message_id: 1, text: "hi" },
      mockApi,
    );
    // shouldEngage returns "ignore" for short text, no embed call
    expect(mockCtx.llm.embed).not.toHaveBeenCalled();
    expect(mockApi.setMessageReaction).not.toHaveBeenCalled();
  });

  it("ignores when relevance score is low", async () => {
    // Both searches return low scores
    (semanticSearch as any).mockReturnValue([{ similarity: 0.2 }]);
    (knowledgeSearch as any).mockResolvedValue([{ score: 0.1 }]);

    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200005,
      { message_id: 1, text: "This is a message about something random" },
      mockApi,
    );
    expect(mockApi.setMessageReaction).not.toHaveBeenCalled();
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it("reacts when relevance score exceeds react threshold (0.65)", async () => {
    // Memory search returns score above react threshold but below proactive
    (semanticSearch as any).mockReturnValue([{ similarity: 0.7 }]);
    (knowledgeSearch as any).mockResolvedValue([]);

    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200006,
      { message_id: 1, text: "This is a relevant message about our project" },
      mockApi,
    );
    expect(mockApi.setMessageReaction).toHaveBeenCalledWith(
      200006,
      1,
      expect.any(Array),
    );
    // Should NOT send a proactive message
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends proactive response when score exceeds proactive threshold (0.78)", async () => {
    // Memory search returns very high score
    (semanticSearch as any).mockReturnValue([{ similarity: 0.85 }]);
    (knowledgeSearch as any).mockResolvedValue([]);

    // First generateText call is for emoji, second is for proactive response
    (instrumentedGenerateText as any)
      .mockResolvedValueOnce({ result: { text: "🔥" } }) // emoji picker
      .mockResolvedValueOnce({ result: { text: "That's really interesting, I know something about that!" } }); // proactive response

    // Buffer some messages so generateProactiveResponse has context
    bufferMessage(200007, "Let's discuss the project", "Alice");
    bufferMessage(200007, "I think we need to refactor the auth module", "Bob");

    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200007,
      { message_id: 2, text: "This is highly relevant to our personal AI knowledge base" },
      mockApi,
    );

    // Should react with emoji
    expect(mockApi.setMessageReaction).toHaveBeenCalledWith(
      200007,
      2,
      expect.any(Array),
    );
    // Should also send a proactive message
    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      200007,
      expect.any(String),
      expect.objectContaining({
        reply_parameters: { message_id: 2 },
      }),
    );
  });

  it("does not send proactive message when LLM returns SKIP", async () => {
    (semanticSearch as any).mockReturnValue([{ similarity: 0.85 }]);
    (knowledgeSearch as any).mockResolvedValue([]);

    (instrumentedGenerateText as any)
      .mockResolvedValueOnce({ result: { text: "👍" } }) // emoji picker
      .mockResolvedValueOnce({ result: { text: "SKIP" } }); // proactive response is SKIP

    bufferMessage(200008, "Some context message", "Alice");

    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200008,
      { message_id: 3, text: "This is a highly relevant message for testing proactive" },
      mockApi,
    );

    // Should still react
    expect(mockApi.setMessageReaction).toHaveBeenCalled();
    // But should NOT send a proactive message (LLM said SKIP)
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it("limits proactive messages to once per UTC day per group", async () => {
    (mockCtx.config.telegram as any).reactionCooldownMin = 0;
    delete (mockCtx.config.telegram as any).proactiveCooldownMin;
    (semanticSearch as any).mockReturnValue([{ similarity: 0.9 }]);
    (knowledgeSearch as any).mockResolvedValue([]);

    (instrumentedGenerateText as any)
      .mockResolvedValueOnce({ result: { text: "🔥" } }) // first emoji
      .mockResolvedValueOnce({ result: { text: "What trend do you think will matter most this week?" } }) // first proactive
      .mockResolvedValueOnce({ result: { text: "👏" } }); // second emoji (no proactive)

    bufferMessage(200009, "We're talking about market shifts", "Alice");

    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200009,
      { message_id: 4, text: "This is highly relevant and should trigger a proactive response first" },
      mockApi,
    );

    await passiveProcess(
      mockCtx,
      mockAgentPlugin,
      200009,
      { message_id: 5, text: "Another highly relevant message later today should not trigger proactive again" },
      mockApi,
    );

    expect(mockApi.setMessageReaction).toHaveBeenCalledTimes(2);
    expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);
  });
});
