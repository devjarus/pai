import { Command } from "commander";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeConfig, createLLMClient } from "@personal-ai/core";
import type { Config } from "@personal-ai/core";

type Provider = Config["llm"]["provider"];

const PROVIDER_DEFAULTS: Record<Provider, { model: string; baseUrl: string; embedModel: string }> = {
  ollama: {
    model: "llama3.2",
    baseUrl: "http://127.0.0.1:11434",
    embedModel: "nomic-embed-text",
  },
  openai: {
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    embedModel: "text-embedding-3-small",
  },
  anthropic: {
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com",
    embedModel: "text-embedding-3-small",
  },
};

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export function createInitCommand(): Command {
  const cmd = new Command("init")
    .description("Initialize pai configuration interactively")
    .action(async () => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      try {
        console.log("\n  pai init — Configure your persistent AI memory\n");

        // 1. Provider
        const providerInput = await ask(rl, `  LLM provider (ollama/openai/anthropic) [ollama]: `);
        const provider: Provider = (["ollama", "openai", "anthropic"].includes(providerInput) ? providerInput : "ollama") as Provider;
        const defaults = PROVIDER_DEFAULTS[provider];

        // 2. Model
        const modelInput = await ask(rl, `  Model name [${defaults.model}]: `);
        const model = modelInput || defaults.model;

        // 3. Base URL
        const baseUrlInput = await ask(rl, `  Base URL [${defaults.baseUrl}]: `);
        const baseUrl = baseUrlInput || defaults.baseUrl;

        // 4. API key (for openai/anthropic)
        let apiKey: string | undefined;
        if (provider === "openai" || provider === "anthropic") {
          const keyInput = await ask(rl, `  API key (required for ${provider}): `);
          apiKey = keyInput || undefined;
          if (!apiKey) {
            console.log("\n  Warning: No API key provided. You can set PAI_LLM_API_KEY later.\n");
          }
        }

        // 5. Embed model
        const embedInput = await ask(rl, `  Embedding model [${defaults.embedModel}]: `);
        const embedModel = embedInput || defaults.embedModel;

        // Close readline before health check (so we don't block on input)
        rl.close();

        // 6. Validate connection
        console.log(`\n  Checking ${provider} connection...`);
        const llmConfig: Config["llm"] = {
          provider,
          model,
          baseUrl,
          apiKey,
          embedModel,
          fallbackMode: "local-first",
        };
        const llm = createLLMClient(llmConfig);
        const healthResult = await llm.health();

        if (healthResult.ok) {
          console.log(`  Connected to ${provider} successfully.\n`);
        } else {
          console.log(`  Warning: Could not connect to ${provider}. Config will be saved anyway.\n`);
        }

        // 7. Write config file
        const dataDir = join(homedir(), ".personal-ai");
        const configToWrite: Partial<Config> = {
          llm: llmConfig,
        };
        writeConfig(dataDir, configToWrite);

        // 8. Success
        console.log(`  Configuration saved to ${join(dataDir, "config.json")}`);
        console.log(`  Run "pai health" to verify your setup.\n`);
      } catch (err) {
        rl.close();
        throw err;
      }
    });

  return cmd;
}
