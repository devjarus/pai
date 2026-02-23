import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { Config } from "./types.js";

const DEFAULT_HOME = join(homedir(), ".personal-ai");
const DEFAULT_DATA_DIR = join(DEFAULT_HOME, "data");

export function findGitRoot(from: string): string | null {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveConfigFilePath(env: Record<string, string | undefined>): string {
  return join(env["PAI_HOME"] ?? DEFAULT_HOME, "config.json");
}

export function loadConfigFile(homeDir?: string): Partial<Config> {
  const configPath = join(homeDir ?? DEFAULT_HOME, "config.json");
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return {};
  }
}

export function writeConfig(homeDir: string, config: Partial<Config>): void {
  mkdirSync(homeDir, { recursive: true });
  const configPath = join(homeDir, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function resolveDataDir(
  env: Record<string, string | undefined>,
  fileConfig?: Partial<Config>,
): string {
  // 1. Env var override
  if (env["PAI_DATA_DIR"]) return env["PAI_DATA_DIR"];
  // 2. Config file setting
  if (fileConfig?.dataDir) return fileConfig.dataDir;
  // 3. Default
  return DEFAULT_DATA_DIR;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const fileConfig = loadConfigFile(env["PAI_HOME"]);
  const fileLlm: Partial<Config["llm"]> = fileConfig.llm ?? {};
  const fileTelegram: Partial<NonNullable<Config["telegram"]>> = fileConfig.telegram ?? {};

  // Telegram config: env vars override config file
  const telegramToken = env["PAI_TELEGRAM_TOKEN"] ?? fileTelegram.token;
  const telegramEnabled = env["PAI_TELEGRAM_ENABLED"] === "true" ? true
    : env["PAI_TELEGRAM_ENABLED"] === "false" ? false
    : fileTelegram.enabled;

  const config: Config = {
    dataDir: resolveDataDir(env, fileConfig),
    llm: {
      provider: (env["PAI_LLM_PROVIDER"] as Config["llm"]["provider"]) ?? (fileLlm.provider as Config["llm"]["provider"]) ?? "ollama",
      model: env["PAI_LLM_MODEL"] ?? fileLlm.model ?? "llama3.2",
      embedModel: env["PAI_LLM_EMBED_MODEL"] ?? fileLlm.embedModel,
      embedProvider: (env["PAI_LLM_EMBED_PROVIDER"] as Config["llm"]["embedProvider"]) ?? fileLlm.embedProvider ?? "auto",
      baseUrl: env["PAI_LLM_BASE_URL"] ?? fileLlm.baseUrl ?? "http://127.0.0.1:11434",
      apiKey: env["PAI_LLM_API_KEY"] ?? fileLlm.apiKey,
    },
    logLevel: (env["PAI_LOG_LEVEL"] as Config["logLevel"]) ?? (fileConfig.logLevel as Config["logLevel"]) ?? "silent",
    plugins: env["PAI_PLUGINS"]?.split(",").map((s) => s.trim()) ?? fileConfig.plugins ?? ["memory", "tasks"],
    webSearchEnabled: env["PAI_WEB_SEARCH"] === "false" ? false : (fileConfig.webSearchEnabled ?? true),
    authToken: env["PAI_AUTH_TOKEN"] ?? fileConfig.authToken,
  };

  // Only add telegram section if any value is set
  if (telegramToken !== undefined || telegramEnabled !== undefined) {
    config.telegram = {};
    if (telegramToken) config.telegram.token = telegramToken;
    if (telegramEnabled !== undefined) config.telegram.enabled = telegramEnabled;
    if (fileTelegram.ownerUsername) config.telegram.ownerUsername = fileTelegram.ownerUsername;
  }

  return config;
}
