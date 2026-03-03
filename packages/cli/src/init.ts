import { Command } from "commander";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeConfig, createLLMClient } from "@personal-ai/core";
import type { Config } from "@personal-ai/core";

type Provider = Config["llm"]["provider"];

interface ProviderPreset {
  provider: Provider;
  model: string;
  baseUrl: string;
  embedModel: string;
  needsKey: boolean;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  ollama: {
    provider: "ollama",
    model: "llama3.2",
    baseUrl: "http://127.0.0.1:11434",
    embedModel: "nomic-embed-text",
    needsKey: false,
  },
  "ollama-cloud": {
    provider: "openai",
    model: "glm-5",
    baseUrl: "https://ollama.com/v1",
    embedModel: "nomic-embed-text",
    needsKey: true,
  },
  openai: {
    provider: "openai",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    embedModel: "text-embedding-3-small",
    needsKey: true,
  },
  anthropic: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com",
    embedModel: "text-embedding-3-small",
    needsKey: true,
  },
  google: {
    provider: "google",
    model: "gemini-2.0-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    embedModel: "text-embedding-004",
    needsKey: true,
  },
};

const VALID_CHOICES = Object.keys(PROVIDER_PRESETS);

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
        const providerInput = await ask(rl, `  LLM provider (${VALID_CHOICES.join("/")}) [ollama]: `);
        const choice = VALID_CHOICES.includes(providerInput) ? providerInput : "ollama";
        const preset = PROVIDER_PRESETS[choice]!;

        // 2. Model
        const modelInput = await ask(rl, `  Model name [${preset.model}]: `);
        const model = modelInput || preset.model;

        // 3. Base URL
        const baseUrlInput = await ask(rl, `  Base URL [${preset.baseUrl}]: `);
        const baseUrl = baseUrlInput || preset.baseUrl;

        // 4. API key
        let apiKey: string | undefined;
        if (preset.needsKey) {
          const keyInput = await ask(rl, `  API key (required for ${choice}): `);
          apiKey = keyInput || undefined;
          if (!apiKey) {
            console.log("\n  Warning: No API key provided. You can set PAI_LLM_API_KEY later.\n");
          }
        }

        // 5. Embed model
        const embedInput = await ask(rl, `  Embedding model [${preset.embedModel}]: `);
        const embedModel = embedInput || preset.embedModel;

        rl.close();

        // 6. Validate connection
        console.log(`\n  Checking ${choice} connection...`);
        const llmConfig: Config["llm"] = {
          provider: preset.provider,
          model,
          baseUrl,
          apiKey,
          embedModel,
          fallbackMode: "local-first",
        };
        const llm = createLLMClient(llmConfig);
        const healthResult = await llm.health();

        if (healthResult.ok) {
          console.log(`  Connected to ${choice} successfully.\n`);
        } else {
          console.log(`  Warning: Could not connect to ${choice}. Config will be saved anyway.\n`);
        }

        // 7. Write config file
        const dataDir = join(homedir(), ".personal-ai");
        writeConfig(dataDir, { llm: llmConfig } as Partial<Config>);

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
