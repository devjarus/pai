import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadConfig, createStorage, createLLMClient, createLogger, memoryMigrations, threadMigrations, knowledgeMigrations } from "@personal-ai/core";
import { taskMigrations } from "@personal-ai/plugin-tasks";
import type { AgentPlugin, PluginContext } from "@personal-ai/core";
import { assistantPlugin } from "@personal-ai/plugin-assistant";
import { curatorPlugin } from "@personal-ai/plugin-curator";
import { telegramMigrations, createBot } from "@personal-ai/plugin-telegram";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";

export interface ServerContext {
  ctx: PluginContext;
  agents: AgentPlugin[];
  /** Reinitialize storage and LLM after config change */
  reinitialize(): void;
  /** Telegram bot lifecycle */
  telegramBot: unknown;
  telegramStatus: { running: boolean; username?: string; error?: string };
  startTelegramBot(): void;
  stopTelegramBot(): void;
}

export async function createServer(options?: { port?: number; host?: string; public?: boolean }) {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { dir: config.dataDir });
  const storage = createStorage(config.dataDir, logger);
  const llm = createLLMClient(config.llm, logger);

  storage.migrate("memory", memoryMigrations);
  storage.migrate("tasks", taskMigrations);
  storage.migrate("threads", threadMigrations);
  storage.migrate("telegram", telegramMigrations);
  storage.migrate("knowledge", knowledgeMigrations);

  const ctx: PluginContext = { config, storage, llm, logger };
  const agents: AgentPlugin[] = [assistantPlugin, curatorPlugin];

  // Telegram bot state — use ReturnType to avoid importing grammy types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let telegramBot: any = null;
  const telegramStatus: ServerContext["telegramStatus"] = { running: false };

  function startTelegramBot(): void {
    const token = ctx.config.telegram?.token;
    const enabled = ctx.config.telegram?.enabled;
    if (!token || !enabled) return;

    // Stop existing bot if running
    stopTelegramBot();

    try {
      const bot = createBot(token, ctx, assistantPlugin);
      telegramBot = bot;
      bot.start({
        onStart: (botInfo: { username: string }) => {
          telegramStatus.running = true;
          telegramStatus.username = botInfo.username;
          telegramStatus.error = undefined;
          console.log(`Telegram bot @${botInfo.username} started`);
        },
      });
      bot.catch((err: { message?: string }) => {
        telegramStatus.error = err.message ?? String(err);
        ctx.logger.error("Telegram bot error", { error: telegramStatus.error });
      });
    } catch (err) {
      telegramStatus.error = err instanceof Error ? err.message : String(err);
      telegramStatus.running = false;
      ctx.logger.error("Failed to start Telegram bot", { error: telegramStatus.error });
    }
  }

  function stopTelegramBot(): void {
    if (telegramBot) {
      try { (telegramBot as { stop(): void }).stop(); } catch { /* ignore */ }
      telegramBot = null;
    }
    telegramStatus.running = false;
    telegramStatus.username = undefined;
    telegramStatus.error = undefined;
  }

  function reinitialize() {
    // Keep reference to old storage so in-flight requests can finish
    const oldStorage = ctx.storage;

    // Reload config and recreate connections
    const newConfig = loadConfig();
    const newLogger = createLogger(newConfig.logLevel, { dir: newConfig.dataDir });
    const newStorage = createStorage(newConfig.dataDir, newLogger);
    const newLlm = createLLMClient(newConfig.llm, newLogger);

    newStorage.migrate("memory", memoryMigrations);
    newStorage.migrate("tasks", taskMigrations);
    newStorage.migrate("threads", threadMigrations);
    newStorage.migrate("telegram", telegramMigrations);
    newStorage.migrate("knowledge", knowledgeMigrations);

    // Update ctx in place so all routes see the new connections
    Object.assign(ctx, {
      config: newConfig,
      storage: newStorage,
      llm: newLlm,
      logger: newLogger,
    });

    // Close old storage after a delay to let in-flight requests drain
    setTimeout(() => {
      try { oldStorage.close(); } catch { /* ignore */ }
    }, 5000);

    // Restart or stop Telegram bot based on new config
    if (newConfig.telegram?.enabled && newConfig.telegram?.token) {
      startTelegramBot();
    } else {
      stopTelegramBot();
    }
  }

  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin requests (no Origin header)
      if (!origin) return cb(null, true);
      // Allow localhost, 127.0.0.1, and private LAN IPs on any port
      if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error("CORS origin not allowed"), false);
    },
  });

  // Serve static UI build if it exists
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const uiDistPath = join(__dirname, "../../ui/dist");
  if (existsSync(uiDistPath)) {
    await app.register(fastifyStatic, {
      root: uiDistPath,
      prefix: "/",
      wildcard: false, // Let API routes take priority
    });
  }

  const serverCtx: ServerContext = {
    ctx, agents, reinitialize,
    get telegramBot() { return telegramBot; },
    telegramStatus,
    startTelegramBot,
    stopTelegramBot,
  };

  // Health endpoint (auth-exempt)
  app.get("/api/health", async () => {
    try {
      const result = await ctx.llm.health();
      return { ok: result.ok, provider: result.provider };
    } catch {
      return { ok: false, provider: "unknown" };
    }
  });

  registerMemoryRoutes(app, serverCtx);
  registerAgentRoutes(app, serverCtx);
  registerConfigRoutes(app, serverCtx);
  registerKnowledgeRoutes(app, serverCtx);

  // SPA fallback — serve index.html for non-API routes
  app.setNotFoundHandler(async (request, reply) => {
    if (!request.url.startsWith("/api/")) {
      const indexPath = join(uiDistPath, "index.html");
      if (existsSync(indexPath)) {
        return reply.sendFile("index.html");
      }
    }
    return reply.status(404).send({ error: "Not found" });
  });

  const port = options?.port ?? 3141;
  const host = options?.host ?? "127.0.0.1";
  const isPublic = options?.public ?? !!process.env.PAI_PUBLIC;
  const isNonLocal = host !== "127.0.0.1" && host !== "localhost" && host !== "::1";

  // Guard: refuse non-localhost binding without --public
  if (isNonLocal && !isPublic) {
    console.error(
      `Error: Binding to ${host} exposes your data without authentication.\n` +
      `Use --public flag or set PAI_PUBLIC=1 to confirm.`,
    );
    process.exit(1);
  }

  if (isPublic && isNonLocal) {
    console.warn(`WARNING: Server is publicly accessible on ${host}:${port}. Ensure authentication is configured.`);
  }

  // Auth token for public mode
  const authToken = process.env.PAI_AUTH_TOKEN ?? ctx.config.authToken;
  if (isPublic && isNonLocal && !authToken) {
    console.warn("WARNING: No PAI_AUTH_TOKEN set. API is unauthenticated in public mode.");
  }

  // Register auth hook when public + token is configured
  if (isPublic && authToken) {
    app.addHook("onRequest", async (request, reply) => {
      // Skip auth for static files and non-API routes
      if (!request.url.startsWith("/api/")) return;
      // Skip health endpoint
      if (request.url === "/api/health") return;

      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const headerToken = request.headers["x-pai-token"] as string | undefined;
      const token = bearer ?? headerToken;

      if (token !== authToken) {
        reply.status(401).send({ error: "Unauthorized" });
      }
    });
  }

  await app.listen({ port, host });
  console.log(`pai server running at http://${host}:${port}${isPublic ? " (public mode)" : ""}`);

  // Auto-start Telegram bot if enabled in config
  if (config.telegram?.enabled && config.telegram?.token) {
    startTelegramBot();
  }

  // Write PID file for process management
  const pidFile = join(homedir(), ".personal-ai", "server.pid");
  try {
    writeFileSync(pidFile, `${process.pid}\n${port}\n${host}`);
  } catch { /* dir may not exist yet — non-critical */ }

  // Clean shutdown — use ctx.storage (may be reassigned after reinitialize)
  const shutdown = async () => {
    try { unlinkSync(pidFile); } catch { /* ignore */ }
    stopTelegramBot();
    try { await app.close(); } catch { /* ignore */ }
    try { ctx.storage.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => { shutdown(); });
  process.on("SIGINT", () => { shutdown(); });

  return app;
}

// Direct execution — parse CLI args
function parseArgs(): { port?: number; host?: string; public?: boolean } {
  const args = process.argv.slice(2);
  const opts: { port?: number; host?: string; public?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
      opts.port = parseInt(args[++i]!, 10);
    } else if ((args[i] === "--host" || args[i] === "-H") && args[i + 1]) {
      opts.host = args[++i];
    } else if (args[i] === "--public") {
      opts.public = true;
    }
  }
  return opts;
}

createServer(parseArgs()).catch((err: unknown) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
