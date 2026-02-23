import { describe, it, expect, vi } from "vitest";
import { consolidateConversation } from "../../src/memory/consolidate.js";
import type { ChatMessage, LLMClient, Storage } from "../../src/types.js";

function mockLLM(summaryText: string): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({ text: summaryText, usage: {} }),
    embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
    streamChat: vi.fn(),
    health: vi.fn(),
    getModel: vi.fn(),
  } as unknown as LLMClient;
}

function mockStorage(): Storage {
  return {
    run: vi.fn(),
    query: vi.fn().mockReturnValue([{
      id: "ep_1", timestamp: "2026-02-22", context: null,
      action: "test", outcome: null, tags_json: "[]",
    }]),
    db: {} as any,
    migrate: vi.fn(),
    close: vi.fn(),
  } as unknown as Storage;
}

describe("consolidateConversation", () => {
  it("summarizes conversation turns into an episode", async () => {
    const llm = mockLLM("User discussed their React project and decided to use Zustand over Redux.");
    const storage = mockStorage();
    const turns: ChatMessage[] = [
      { role: "user", content: "I'm building a React app and need state management" },
      { role: "assistant", content: "You could use Redux, Zustand, or Jotai." },
      { role: "user", content: "I think Zustand is simpler, let's go with that" },
      { role: "assistant", content: "Great choice! Zustand is lightweight." },
    ];

    const result = await consolidateConversation(storage, llm, turns);

    expect(result).toBeDefined();
    expect(result!.summary).toContain("Zustand");
    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(llm.embed).toHaveBeenCalledTimes(1);
    expect(storage.run).toHaveBeenCalled();
  });

  it("returns null for too few turns", async () => {
    const llm = mockLLM("summary");
    const storage = mockStorage();
    const turns: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];

    const result = await consolidateConversation(storage, llm, turns);
    expect(result).toBeNull();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("returns null when LLM returns NONE", async () => {
    const llm = mockLLM("NONE");
    const storage = mockStorage();
    const turns: ChatMessage[] = [
      { role: "user", content: "what time is it" },
      { role: "assistant", content: "I don't have access to the current time" },
      { role: "user", content: "ok thanks" },
      { role: "assistant", content: "You're welcome!" },
    ];

    const result = await consolidateConversation(storage, llm, turns);
    expect(result).toBeNull();
  });

  it("does not crash when embed fails", async () => {
    const llm = mockLLM("User talked about hiking trails.");
    (llm.embed as any).mockRejectedValue(new Error("embed failed"));
    const storage = mockStorage();
    const turns: ChatMessage[] = [
      { role: "user", content: "I love hiking in Marin" },
      { role: "assistant", content: "Marin has great trails!" },
      { role: "user", content: "The Dipsea is my favorite" },
      { role: "assistant", content: "Classic trail!" },
    ];

    const result = await consolidateConversation(storage, llm, turns);
    expect(result).toBeDefined();
    expect(storage.run).toHaveBeenCalled();
  });
});
