import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import { writeConfig, loadConfigFile } from "@personal-ai/core";
import type { ServerContext } from "../index.js";

function sanitizeConfig(config: { llm: Record<string, unknown>; telegram?: Record<string, unknown>; [key: string]: unknown }) {
  const { llm, telegram, ...rest } = config;
  return {
    ...rest,
    llm: {
      provider: llm.provider,
      model: llm.model,
      baseUrl: llm.baseUrl,
      embedModel: llm.embedModel,
      embedProvider: llm.embedProvider ?? "auto",
    },
    telegram: {
      enabled: telegram?.enabled ?? false,
      hasToken: !!telegram?.token,
    },
  };
}

export function registerConfigRoutes(app: FastifyInstance, serverCtx: ServerContext): void {
  const { ctx } = serverCtx;
  app.get("/api/config", async () => ({
    ...sanitizeConfig(ctx.config as never),
    telegram: {
      ...sanitizeConfig(ctx.config as never).telegram,
      running: serverCtx.telegramStatus.running,
      username: serverCtx.telegramStatus.username,
      error: serverCtx.telegramStatus.error,
    },
  }));

  app.put("/api/config", async (request, reply) => {
    const body = request.body as {
      provider?: string;
      model?: string;
      baseUrl?: string;
      embedModel?: string;
      embedProvider?: string;
      apiKey?: string;
      dataDir?: string;
      telegramToken?: string;
      telegramEnabled?: boolean;
    };

    const validProviders = new Set(["ollama", "openai", "anthropic"]);

    // Validate provider
    if (body.provider && !validProviders.has(body.provider)) {
      return reply.status(400).send({ error: `Invalid provider. Must be one of: ${[...validProviders].join(", ")}` });
    }

    // Validate baseUrl is a valid http/https URL
    if (body.baseUrl !== undefined && body.baseUrl !== "") {
      try {
        const parsed = new URL(body.baseUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return reply.status(400).send({ error: "Base URL must use http or https protocol" });
        }
      } catch {
        return reply.status(400).send({ error: "Base URL is not a valid URL" });
      }
    }

    // Validate dataDir stays within home directory
    if (body.dataDir) {
      const resolved = resolve(body.dataDir);
      const home = homedir();
      if (resolved !== home && !resolved.startsWith(home + "/")) {
        return reply.status(400).send({ error: "Data directory must be within home directory" });
      }
    }

    const update: Record<string, unknown> = {};
    const llmUpdate: Record<string, unknown> = {};

    if (body.provider) llmUpdate.provider = body.provider;
    if (body.model) llmUpdate.model = body.model;
    if (body.baseUrl !== undefined) llmUpdate.baseUrl = body.baseUrl;
    if (body.embedModel !== undefined) llmUpdate.embedModel = body.embedModel;
    if (body.embedProvider !== undefined) {
      const validEmbedProviders = new Set(["auto", "ollama", "openai", "local"]);
      if (!validEmbedProviders.has(body.embedProvider)) {
        return reply.status(400).send({ error: `Invalid embed provider. Must be one of: ${[...validEmbedProviders].join(", ")}` });
      }
      llmUpdate.embedProvider = body.embedProvider;
    }
    if (body.apiKey !== undefined) llmUpdate.apiKey = body.apiKey;

    if (Object.keys(llmUpdate).length > 0) {
      update.llm = { ...ctx.config.llm, ...llmUpdate };
    }

    if (body.dataDir) {
      update.dataDir = body.dataDir;
    }

    // Telegram settings
    if (body.telegramToken !== undefined || body.telegramEnabled !== undefined) {
      const existing = ctx.config.telegram ?? {};
      const telegramUpdate: Record<string, unknown> = { ...existing };
      if (body.telegramToken !== undefined) telegramUpdate.token = body.telegramToken || undefined;
      if (body.telegramEnabled !== undefined) telegramUpdate.enabled = body.telegramEnabled;
      update.telegram = telegramUpdate;
    }

    // Config file lives at ~/.personal-ai/config.json
    // Merge update into existing file config to avoid dropping unrelated sections
    const homeDir = join(homedir(), ".personal-ai");
    const existing = loadConfigFile(homeDir);
    const merged = { ...existing, ...update };
    writeConfig(homeDir, merged as never);

    // Reinitialize storage, LLM, and config from the new settings
    serverCtx.reinitialize();

    return sanitizeConfig(serverCtx.ctx.config as never);
  });

  // Directory browser endpoint for the UI — restricted to home directory
  app.get("/api/browse", async (request, reply) => {
    const { path: dirPath } = request.query as { path?: string };
    const home = homedir();
    const targetPath = dirPath ? resolve(dirPath) : home;

    // Block directory traversal outside home (use separator to avoid prefix collision: /Users/suraj vs /Users/suraj-other)
    if (targetPath !== home && !targetPath.startsWith(home + "/")) {
      return reply.status(403).send({ error: "Cannot browse outside home directory" });
    }

    try {
      const entries = readdirSync(targetPath)
        .filter((name) => {
          if (name.startsWith(".") && name !== ".personal-ai") return false;
          try {
            return statSync(join(targetPath, name)).isDirectory();
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
