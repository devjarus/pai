import { describe, it, expect, vi } from "vitest";
import { extractBelief } from "../src/remember.js";
import type { LLMClient } from "@personal-ai/core";

describe("extractBelief", () => {
  it("should extract a belief from episode text using LLM", async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue("TypeScript strict mode catches more bugs at compile time"),
      health: vi.fn().mockResolvedValue({ ok: true, provider: "mock" }),
    };
    const result = await extractBelief(mockLLM, "Switched to TypeScript strict mode and found 12 hidden bugs");
    expect(result).toBe("TypeScript strict mode catches more bugs at compile time");
    expect(mockLLM.chat).toHaveBeenCalledOnce();
  });
});
