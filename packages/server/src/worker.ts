import { loadConfig, createStorage, createLLMClient, createLogger, configureLlmTraffic } from "@personal-ai/core";
import { runAllMigrations } from "./migrations.js";
import { WorkerLoop } from "./workers.js";
import { BackgroundDispatcher, attachBackgroundDispatch } from "./background-dispatcher.js";

const config = loadConfig();
configureLlmTraffic(config.workers?.llmTraffic);
const logger = createLogger(config.logLevel, { dir: config.dataDir });
const storage = createStorage(config.dataDir, logger);
const llm = createLLMClient(config.llm, logger, storage);

runAllMigrations(storage);

const ctx = { config, storage, llm, logger };
const backgroundDispatcher = new BackgroundDispatcher(ctx);
attachBackgroundDispatch(ctx, backgroundDispatcher);
const workerLoop = new WorkerLoop(ctx);
backgroundDispatcher.start();
workerLoop.start();

console.log("pai worker running (Ctrl+C to stop)");

const shutdown = () => {
  console.log("Shutting down workers...");
  workerLoop.stop();
  backgroundDispatcher.stop();
  storage.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
