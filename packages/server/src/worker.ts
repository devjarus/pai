import { loadConfig, createStorage, createLLMClient, createLogger } from "@personal-ai/core";
import { runAllMigrations } from "./migrations.js";
import { WorkerLoop } from "./workers.js";

const config = loadConfig();
const logger = createLogger(config.logLevel, { dir: config.dataDir });
const storage = createStorage(config.dataDir, logger);
const llm = createLLMClient(config.llm, logger);

runAllMigrations(storage);

const ctx = { config, storage, llm, logger };
const workerLoop = new WorkerLoop(ctx);
workerLoop.start();

console.log("pai worker running (Ctrl+C to stop)");

const shutdown = () => {
  console.log("Shutting down workers...");
  workerLoop.stop();
  storage.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
