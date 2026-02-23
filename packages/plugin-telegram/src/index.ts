import type { Plugin, PluginContext, Command, Migration } from "@personal-ai/core";
import {
  loadConfig, createStorage, createLLMClient, createLogger,
  memoryMigrations, threadMigrations,
} from "@personal-ai/core";
import { taskMigrations } from "@personal-ai/plugin-tasks";
import { assistantPlugin } from "@personal-ai/plugin-assistant";
import { createBot } from "./bot.js";

// Re-exports
export { createBot } from "./bot.js";
export { runAgentChat, createThread, deleteThread, clearThread } from "./chat.js";
export { markdownToTelegramHTML, splitMessage } from "./formatter.js";

/** Migrations for telegram_threads mapping table */
export const telegramMigrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS telegram_threads (
        chat_id INTEGER PRIMARY KEY,
        thread_id TEXT NOT NULL,
        username TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
];

export const telegramPlugin: Plugin = {
  name: "telegram",
  version: "0.1.0",
  migrations: telegramMigrations,
  commands(_ctx: PluginContext): Command[] {
    return [];
  },
};

// Standalone entry — run when executed directly
const isDirectExecution = process.argv[1]?.endsWith("plugin-telegram/dist/index.js") ||
  process.argv[1]?.endsWith("plugin-telegram/src/index.ts");

if (isDirectExecution) {
  const config = loadConfig();
  const token = config.telegram?.token;
  if (!token) {
    console.error("Error: Telegram bot token is required.");
    console.error("Set it via PAI_TELEGRAM_TOKEN env var, or configure in the Settings UI.");
    console.error("Get a token from @BotFather on Telegram.");
    process.exit(1);
  }
  const logger = createLogger(config.logLevel, { dir: config.dataDir });
  const storage = createStorage(config.dataDir, logger);
  const llm = createLLMClient(config.llm, logger);

  // Run all migrations
  storage.migrate("memory", memoryMigrations);
  storage.migrate("tasks", taskMigrations);
  storage.migrate("threads", threadMigrations);
  storage.migrate("telegram", telegramMigrations);

  const ctx: PluginContext = { config, storage, llm, logger };
  const bot = createBot(token, ctx, assistantPlugin);

  console.log("Starting Telegram bot...");
  bot.start({
    onStart: (botInfo) => {
      console.log(`Telegram bot @${botInfo.username} is running!`);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    bot.stop();
    storage.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
