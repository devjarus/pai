import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { timingSafeEqual } from "node:crypto";
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
import { registerTaskRoutes } from "./routes/tasks.js";

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

  // On PaaS (Railway, etc.) volumes may mount after the container starts.
  // Retry storage initialization to handle this race condition.
  let storage!: ReturnType<typeof createStorage>;
  const maxRetries = process.env.PORT ? 10 : 1;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      storage = createStorage(config.dataDir, logger);
      break;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`Storage init attempt ${attempt}/${maxRetries} failed (${msg}), retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const llm = createLLMClient(config.llm, logger);

  // Detect PaaS without persistent volume — warn loudly so operators notice
  if (process.env.PORT) {
    const fs = await import("node:fs");
    const sentinelPath = `${config.dataDir}/.pai-volume-check`;
    const hasSentinel = fs.existsSync(sentinelPath);
    if (!hasSentinel) {
      // First boot or ephemeral filesystem — write sentinel
      try {
        fs.writeFileSync(sentinelPath, new Date().toISOString());
      } catch { /* read-only or permission issue */ }
      logger.warn(
        "First boot detected on PaaS. If threads/data disappear after restarts, " +
        "ensure a persistent volume is mounted at the data directory. " +
        "On Railway: Settings → Volumes → mount path /data",
      );
      console.warn(
        "⚠️  PAI: No persistent volume detected at " + config.dataDir + ". " +
        "Data will be LOST on container restart. " +
        "Mount a volume at /data (Railway: Settings → Volumes).",
      );
    } else {
      logger.info("Persistent volume detected — data will survive restarts");
    }
  }

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

  // Detect PaaS environment (Railway, Render, etc.) via PORT env var
  const isPaaS = !!process.env.PORT;

  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    // Trust proxy when behind a PaaS load balancer — required for correct client IP in rate limiting
    trustProxy: isPaaS,
  });

  // --- Security Headers ---
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],  // Tailwind uses inline styles
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,  // Allow loading cross-origin images in chat
  });

  // --- Rate Limiting ---
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    // Use real IP behind proxy, fall back to remote address
    keyGenerator: (request) => request.ip,
  });

  // --- CORS ---
  const corsOrigin = process.env.PAI_CORS_ORIGIN;
  function isAllowedOrigin(origin: string): boolean {
    try {
      const url = new URL(origin);
      const host = url.hostname;
      // Allow localhost and loopback
      if (host === "localhost" || host === "127.0.0.1") return true;
      // Allow private RFC1918 ranges (for LAN access)
      if (/^(192\.168|10)\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
      if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
      // Allow Railway-generated domains (must be https, alphanumeric subdomain)
      if (url.protocol === "https:" && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.up\.railway\.app$/.test(host)) return true;
      // Allow custom domain via PAI_CORS_ORIGIN (exact match)
      if (corsOrigin && origin === corsOrigin) return true;
      return false;
    } catch {
      return false;
    }
  }
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, true);
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

  // Health endpoint (auth-exempt, cached to prevent DoS via external calls)
  let cachedHealth: { ok: boolean; provider: string; ts: number } | null = null;
  app.get("/api/health", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async () => {
    const now = Date.now();
    if (cachedHealth && now - cachedHealth.ts < 30_000) {
      return { ok: cachedHealth.ok, provider: cachedHealth.provider };
    }
    try {
      const result = await ctx.llm.health();
      cachedHealth = { ok: result.ok, provider: result.provider, ts: now };
      return { ok: result.ok, provider: result.provider };
    } catch {
      cachedHealth = { ok: false, provider: "unknown", ts: now };
      return { ok: false, provider: "unknown" };
    }
  });

  registerMemoryRoutes(app, serverCtx);
  registerAgentRoutes(app, serverCtx);
  registerConfigRoutes(app, serverCtx);
  registerKnowledgeRoutes(app, serverCtx);
  registerTaskRoutes(app, serverCtx);

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

  // PaaS sets PORT env var — bind to 0.0.0.0 to accept traffic from the load balancer
  // PAI_HOST allows explicit host override (e.g., Docker containers need 0.0.0.0)
  const port = options?.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3141);
  const host = options?.host ?? process.env.PAI_HOST ?? (isPaaS ? "0.0.0.0" : "127.0.0.1");
  const hostExplicit = !!(options?.host || process.env.PAI_HOST);
  const isPublic = options?.public ?? (process.env.PAI_PUBLIC ? true : isPaaS);
  const isNonLocal = host !== "127.0.0.1" && host !== "localhost" && host !== "::1";

  // Guard: refuse non-localhost binding without --public or explicit PAI_HOST (Docker)
  if (isNonLocal && !isPublic && !hostExplicit) {
    console.error(
      `Error: Binding to ${host} exposes your data without authentication.\n` +
      `Use --public flag or set PAI_PUBLIC=1 to confirm.`,
    );
    process.exit(1);
  }

  // Auth token for public mode
  const authToken = process.env.PAI_AUTH_TOKEN ?? ctx.config.authToken;

  // HARD GATE: refuse to start in public mode without auth token
  if (isPublic && isNonLocal && !authToken) {
    console.error(
      "Error: PAI_AUTH_TOKEN is required when running in public mode.\n" +
      "Set PAI_AUTH_TOKEN environment variable with a strong random token (32+ characters).",
    );
    process.exit(1);
  }

  if (isPublic && isNonLocal) {
    console.log(`Server running in public mode on ${host}:${port} (authentication enabled)`);
  }

  // --- Timing-safe token comparison (constant-time, no length leak) ---
  function tokenMatches(provided: string | undefined): boolean {
    if (!authToken || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(authToken);
    // timingSafeEqual throws if lengths differ — catch to avoid length leak
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Register auth hook when running in public mode with a token
  if (isPublic && authToken) {
    app.addHook("onRequest", async (request, reply) => {
      // Skip auth for static files and non-API routes
      if (!request.url.startsWith("/api/")) return;
      // Skip health endpoint (used by load balancers / Railway)
      if (request.url === "/api/health") return;

      const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const headerToken = request.headers["x-pai-token"] as string | undefined;
      const token = bearer ?? headerToken;

      if (!tokenMatches(token)) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    });
  }

  // --- CSRF protection: require JSON content-type for state-changing API requests ---
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS" || request.method === "DELETE") return;
    const ct = request.headers["content-type"] ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/event-stream")) {
      return reply.status(415).send({ error: "Content-Type must be application/json" });
    }
  });

  // --- Stricter rate limits on expensive endpoints ---
  app.addHook("onRoute", (routeOptions) => {
    const path = routeOptions.path;
    if (path === "/api/chat") {
      routeOptions.config = { ...routeOptions.config, rateLimit: { max: 20, timeWindow: "1 minute" } };
    } else if (path === "/api/knowledge/learn") {
      routeOptions.config = { ...routeOptions.config, rateLimit: { max: 10, timeWindow: "1 minute" } };
    } else if (path === "/api/remember") {
      routeOptions.config = { ...routeOptions.config, rateLimit: { max: 30, timeWindow: "1 minute" } };
    }
  });

  // --- Request logging for API calls ---
  app.addHook("onResponse", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    ctx.logger.info("API request", {
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      ip: request.ip,
      responseTime: Math.round(reply.elapsedTime),
    });
  });

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
