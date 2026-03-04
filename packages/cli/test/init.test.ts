import { describe, it, expect } from "vitest";
import { PROVIDER_PRESETS } from "../src/init.js";

describe("pai init PROVIDER_PRESETS", () => {
  it("includes ollama-cloud with correct base URL", () => {
    const preset = PROVIDER_PRESETS["ollama-cloud"];
    expect(preset).toBeDefined();
    expect(preset.baseUrl).toBe("https://ollama.com/v1");
    expect(preset.model).toBe("glm-5");
    expect(preset.provider).toBe("openai");
    expect(preset.needsKey).toBe(true);
  });

  it("includes all expected providers", () => {
    const keys = Object.keys(PROVIDER_PRESETS);
    expect(keys).toContain("ollama");
    expect(keys).toContain("ollama-cloud");
    expect(keys).toContain("openai");
    expect(keys).toContain("anthropic");
    expect(keys).toContain("google");
  });

  it("ollama local does not require a key", () => {
    expect(PROVIDER_PRESETS.ollama.needsKey).toBe(false);
  });

  it("all cloud providers require a key", () => {
    for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
      if (name === "ollama") continue;
      expect(preset.needsKey).toBe(true);
    }
  });

  it("all presets have valid base URLs", () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(() => new URL(preset.baseUrl)).not.toThrow();
    }
  });
});
