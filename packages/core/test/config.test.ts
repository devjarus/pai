import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("should return defaults when no env vars set", () => {
    const config = loadConfig({});
    expect(config.dataDir).toContain("personal-ai");
    expect(config.llm.provider).toBe("ollama");
    expect(config.llm.model).toBe("llama3.2");
    expect(config.llm.baseUrl).toBe("http://127.0.0.1:11434");
    expect(config.logLevel).toBe("silent");
    expect(config.llm.fallbackMode).toBe("local-first");
    expect(config.plugins).toEqual(["memory", "tasks"]);
  });

  it("should override from env", () => {
    const config = loadConfig({
      PAI_DATA_DIR: "/tmp/test-pai",
      PAI_LLM_PROVIDER: "openai",
      PAI_LLM_MODEL: "gpt-4.1-mini",
      PAI_LLM_BASE_URL: "https://api.openai.com/v1",
      PAI_LLM_API_KEY: "sk-test",
      PAI_PLUGINS: "memory",
    });
    expect(config.dataDir).toBe("/tmp/test-pai");
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.model).toBe("gpt-4.1-mini");
    expect(config.llm.apiKey).toBe("sk-test");
    expect(config.plugins).toEqual(["memory"]);
  });
});
