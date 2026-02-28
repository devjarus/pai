import { existsSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeConfig, loadConfigFile } from "@personal-ai/core";
import type { Storage } from "@personal-ai/core";
import type { ServerContext } from "../index.js";
import { validate } from "../validate.js";

function getWorkerLastRun(storage: Storage): Record<string, string | null> {
  try {
    const rows = storage.query<{ source: string; last_processed_at: string }>(
      "SELECT source, last_processed_at FROM learning_watermarks",
    );
    const result: Record<string, string | null> = { threads: null, research: null, knowledge: null };
    for (const row of rows) result[row.source] = row.last_processed_at;
    return result;
  } catch {
    return {};
  }
}

/** Config file location: data dir (persistent volume) on Docker/PaaS, ~/.personal-ai/ locally */
const configDir = process.env.PAI_DATA_DIR ?? join(homedir(), ".personal-ai");

function sanitizeConfig(config: { llm: Record<string, unknown>; telegram?: Record<string, unknown>; workers?: Record<string, unknown>; [key: string]: unknown }) {
  const { llm, telegram, workers, ...rest } = config;
  return {
    ...rest,
    llm: {
      provider: llm.provider,
      model: llm.model,
      baseUrl: llm.baseUrl,
      embedModel: llm.embedModel,
      embedProvider: llm.embedProvider ?? "auto",
      hasApiKey: !!llm.apiKey,
    },
    telegram: {
      enabled: telegram?.enabled ?? false,
      hasToken: !!telegram?.token,
    },
    workers: {
      backgroundLearning: (workers as Record<string, unknown> | undefined)?.backgroundLearning !== false,
      briefing: (workers as Record<string, unknown> | undefined)?.briefing !== false,
    },
  };
}

const ENV_OVERRIDE_MAP: Record<string, string> = {
  PAI_LLM_PROVIDER: "provider",
  PAI_LLM_MODEL: "model",
  PAI_LLM_BASE_URL: "baseUrl",
  PAI_LLM_API_KEY: "apiKey",
  PAI_LLM_EMBED_MODEL: "embedModel",
  PAI_LLM_EMBED_PROVIDER: "embedProvider",
  PAI_DATA_DIR: "dataDir",
};

function getEnvOverrides(): string[] {
  // If config.json exists in data dir (user saved via Settings UI), env vars don't override
  if (existsSync(join(configDir, "config.json"))) return [];
  const overrides: string[] = [];
  for (const [envVar, field] of Object.entries(ENV_OVERRIDE_MAP)) {
    if (process.env[envVar]) overrides.push(field);
  }
  return overrides;
}

const updateConfigSchema = z.object({
  provider: z.enum(["ollama", "openai", "anthropic", "google"]).optional(),
  model: z.string().optional(),
  baseUrl: z
    .string()
    .optional()
    .refine(
      (v) => {
        if (v === undefined || v === "") return true;
        try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; }
      },
      "Base URL must be a valid http or https URL",
    ),
  embedModel: z.string().optional(),
  embedProvider: z.enum(["auto", "ollama", "openai", "google", "local"]).optional(),
  apiKey: z.string().optional(),
  dataDir: z.string().optional(),
  telegramToken: z.string().optional(),
  telegramEnabled: z.boolean().optional(),
  backgroundLearning: z.boolean().optional(),
  briefingEnabled: z.boolean().optional(),
});

export function registerConfigRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const { ctx } = serverCtx;
  app.get("/api/config", async () => {
    const sanitized = sanitizeConfig(ctx.config as never);
    return {
      ...sanitized,
      telegram: {
        ...sanitized.telegram,
        running: serverCtx.telegramStatus.running,
        username: serverCtx.telegramStatus.username,
        error: serverCtx.telegramStatus.error,
      },
      workers: {
        ...sanitized.workers,
        lastRun: getWorkerLastRun(ctx.storage),
      },
      envOverrides: getEnvOverrides(),
    };
  });

  app.put("/api/config", async (request, reply) => {
    const body = validate(updateConfigSchema, request.body);

    // Validate dataDir stays within home directory
    if (body.dataDir) {
      const resolved = resolve(body.dataDir);
      const home = homedir();
      if (resolved !== home && !resolved.startsWith(home + "/")) {
        return reply.status(400).send({ error: "Data directory must be within home directory" });
      }
    }

    // Load existing config from disk once — used to preserve secrets not sent in the request
    const existing = loadConfigFile(configDir);

    const update: Record<string, unknown> = {};
    const llmUpdate: Record<string, unknown> = {};

    if (body.provider) llmUpdate.provider = body.provider;
    if (body.model) llmUpdate.model = body.model;
    if (body.baseUrl !== undefined) llmUpdate.baseUrl = body.baseUrl;
    if (body.embedModel !== undefined) llmUpdate.embedModel = body.embedModel;
    if (body.embedProvider !== undefined) {
      llmUpdate.embedProvider = body.embedProvider;
    }
    if (body.apiKey !== undefined) llmUpdate.apiKey = body.apiKey;

    // Preserve existing secrets from disk when not explicitly changed.
    // The UI sends apiKey/telegramToken only when the user enters a new value;
    // omitting them means "keep existing", not "clear".
    if (body.apiKey === undefined && existing.llm?.apiKey) {
      llmUpdate.apiKey = existing.llm.apiKey;
    }

    if (Object.keys(llmUpdate).length > 0) {
      update.llm = { ...ctx.config.llm, ...llmUpdate };
    }

    if (body.dataDir) {
      update.dataDir = body.dataDir;
    }

    // Worker settings
    if (body.backgroundLearning !== undefined || body.briefingEnabled !== undefined) {
      const existingWorkers = ctx.config.workers ?? {};
      const workersUpdate: Record<string, unknown> = { ...existingWorkers };
      if (body.backgroundLearning !== undefined) workersUpdate.backgroundLearning = body.backgroundLearning;
      if (body.briefingEnabled !== undefined) workersUpdate.briefing = body.briefingEnabled;
      update.workers = workersUpdate;
    }

    // Telegram settings
    if (body.telegramToken !== undefined || body.telegramEnabled !== undefined) {
      const existingTelegram = ctx.config.telegram ?? {};
      const telegramUpdate: Record<string, unknown> = { ...existingTelegram };
      if (body.telegramToken !== undefined) telegramUpdate.token = body.telegramToken || undefined;
      if (body.telegramEnabled !== undefined) telegramUpdate.enabled = body.telegramEnabled;
      // Preserve existing token from disk if not explicitly changed
      if (body.telegramToken === undefined && (existing.telegram as Record<string, unknown>)?.token) {
        telegramUpdate.token = (existing.telegram as Record<string, unknown>).token;
      }
      update.telegram = telegramUpdate;
    }

    // Write config to persistent location
    const merged = { ...existing, ...update };
    writeConfig(configDir, merged as never);

    // Reinitialize storage, LLM, and config from the new settings.
    // Wrapped in try-catch so a bad config never crashes the server.
    try {
      serverCtx.reinitialize();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("reinitialize failed after config update", { error: msg });
      return reply.status(500).send({
        error: `Configuration saved but failed to apply: ${msg}. The server is still running with the previous settings. Fix the configuration and try again.`,
      });
    }

    // Apply user's explicit changes on top of the reloaded config.
    // loadConfig() prefers env vars, but the user explicitly chose new values
    // via the Settings UI — honour those for the running session.
    if (Object.keys(llmUpdate).length > 0) {
      Object.assign(serverCtx.ctx.config.llm, llmUpdate);
    }
    if (body.dataDir) {
      (serverCtx.ctx.config as unknown as Record<string, unknown>).dataDir = body.dataDir;
    }

    return sanitizeConfig(serverCtx.ctx.config as never);
  });

  // Directory browser endpoint for the UI — restricted to home directory
  app.get("/api/browse", async (request, reply) => {
    const { path: dirPath } = request.query as { path?: string };
    const home = homedir();
    const targetPath = dirPath ? resolve(dirPath) : home;

    // Block directory traversal outside home (use separator to avoid prefix collision: /Users/alex vs /Users/alex-other)
    if (targetPath !== home && !targetPath.startsWith(home + "/")) {
      return reply.status(403).send({ error: "Cannot browse outside home directory" });
    }

    try {
      const entries = readdirSync(targetPath)
        .filter((name) => {
          if (name.startsWith(".") && name !== ".personal-ai") return false;
          try {
            const fullPath = join(targetPath, name);
            // Use lstat to not follow symlinks, preventing symlink traversal attacks
            const stat = lstatSync(fullPath);
            if (stat.isSymbolicLink()) {
              // Resolve symlink and verify it stays within home directory
              const real = realpathSync(fullPath);
              if (real !== home && !real.startsWith(home + "/")) return false;
              return statSync(fullPath).isDirectory();
            }
            return stat.isDirectory();
          } catch {
            return false;
          }
        })
        .sort()
        .map((name) => ({
          name,
          path: join(targetPath, name),
        }));

      // Clamp parent to home directory
      const rawParent = resolve(targetPath, "..");
      const parent = (rawParent === home || rawParent.startsWith(home + "/")) ? rawParent : home;

      return {
        current: targetPath,
        parent,
        entries,
      };
    } catch {
      return { current: targetPath, parent: home, entries: [] };
    }
  });
}
