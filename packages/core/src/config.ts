import { join } from "node:path";
import { homedir } from "node:os";
import type { Config } from "./types.js";

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    dataDir: env["PAI_DATA_DIR"] ?? join(homedir(), ".personal-ai"),
    llm: {
      provider: (env["PAI_LLM_PROVIDER"] as Config["llm"]["provider"]) ?? "ollama",
      model: env["PAI_LLM_MODEL"] ?? "llama3.2",
      baseUrl: env["PAI_LLM_BASE_URL"] ?? "http://127.0.0.1:11434",
      apiKey: env["PAI_LLM_API_KEY"],
      fallbackMode:
        (env["PAI_LLM_FALLBACK_MODE"] as Config["llm"]["fallbackMode"]) ?? "local-first",
    },
    plugins: env["PAI_PLUGINS"]?.split(",").map((s) => s.trim()) ?? ["memory", "tasks"],
  };
}
