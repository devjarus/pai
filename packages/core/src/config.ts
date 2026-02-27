import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { Config } from "./types.js";

const DEFAULT_HOME = join(homedir(), ".personal-ai");
const DEFAULT_DATA_DIR = join(DEFAULT_HOME, "data");
const ENC_PREFIX = "enc:";

// Derive a machine-local encryption key from hostname + home directory
// This isn't meant to protect against a determined attacker with user-level access —
// it prevents casual exposure (e.g., accidentally sharing config.json, or backup tools indexing it)
function deriveKey(): Buffer {
  const material = `pai:${homedir()}:${process.env.USER ?? "default"}`;
  return createHash("sha256").update(material).digest();
}

function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
  try {
    const key = deriveKey();
    const data = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (err) {
    console.warn(`[pai] Failed to decrypt secret: ${err instanceof Error ? err.message : String(err)}`);
    return stored.startsWith(ENC_PREFIX) ? "" : stored;
  }
}

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
    const parsed = JSON.parse(raw) as Partial<Config>;

    // Decrypt sensitive fields
    const llm = parsed.llm as Record<string, unknown> | undefined;
    if (llm?.apiKey && typeof llm.apiKey === "string") {
      (llm as Record<string, unknown>).apiKey = decryptSecret(llm.apiKey as string);
    }
    const telegram = parsed.telegram as Record<string, unknown> | undefined;
    if (telegram?.token && typeof telegram.token === "string") {
      (telegram as Record<string, unknown>).token = decryptSecret(telegram.token as string);
    }
    return parsed;
  } catch (err) {
    console.warn(`[pai] Failed to parse config.json at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

export function writeConfig(homeDir: string, config: Partial<Config>): void {
  mkdirSync(homeDir, { recursive: true });
  const configPath = join(homeDir, "config.json");

  // Deep clone to avoid mutating the original config object
  const toWrite = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

  // Encrypt sensitive fields before writing to disk
  const llm = toWrite.llm as Record<string, unknown> | undefined;
  if (llm?.apiKey && typeof llm.apiKey === "string" && !llm.apiKey.startsWith(ENC_PREFIX)) {
    llm.apiKey = encryptSecret(llm.apiKey);
  }
  const telegram = toWrite.telegram as Record<string, unknown> | undefined;
  if (telegram?.token && typeof telegram.token === "string" && !telegram.token.startsWith(ENC_PREFIX)) {
    telegram.token = encryptSecret(telegram.token);
  }
  // Atomic write: write to temp file first, then rename.
  // This prevents corruption if the process is killed mid-write (e.g., Railway deploy).
  const tmpPath = configPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2) + "\n", "utf-8");
  try { chmodSync(tmpPath, 0o600); } catch { /* Windows doesn't support chmod — ignore */ }
  renameSync(tmpPath, configPath);
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

/**
 * Resolve the config home directory.
 * Priority: PAI_HOME env var → ~/.personal-ai
 */
export function resolveConfigHome(env: Record<string, string | undefined> = process.env): string {
  return env["PAI_HOME"] ?? DEFAULT_HOME;
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

  // On Docker/PaaS: if config.json exists in the data dir (saved via Settings UI),
  // those values take priority over env vars (user explicitly chose them).
  // Otherwise (local dev / first boot): env vars > config file (~/.personal-ai) > defaults.
  const dataDirPath = env["PAI_DATA_DIR"];
  const dataDirConfig = (dataDirPath && existsSync(join(dataDirPath, "config.json")))
    ? loadConfigFile(dataDirPath)
    : null;
  const savedLlm: Partial<Config["llm"]> = dataDirConfig?.llm ?? {};

  const config: Config = {
    dataDir: resolveDataDir(env, fileConfig),
    llm: {
      provider: (savedLlm.provider as Config["llm"]["provider"]) ?? (env["PAI_LLM_PROVIDER"] as Config["llm"]["provider"]) ?? (fileLlm.provider as Config["llm"]["provider"]) ?? "ollama",
      model: savedLlm.model ?? env["PAI_LLM_MODEL"] ?? fileLlm.model ?? "llama3.2",
      embedModel: savedLlm.embedModel ?? env["PAI_LLM_EMBED_MODEL"] ?? fileLlm.embedModel,
      embedProvider: (savedLlm.embedProvider as Config["llm"]["embedProvider"]) ?? (env["PAI_LLM_EMBED_PROVIDER"] as Config["llm"]["embedProvider"]) ?? (fileLlm.embedProvider as Config["llm"]["embedProvider"]) ?? "auto",
      baseUrl: savedLlm.baseUrl ?? env["PAI_LLM_BASE_URL"] ?? fileLlm.baseUrl ?? "http://127.0.0.1:11434",
      apiKey: savedLlm.apiKey || env["PAI_LLM_API_KEY"] || fileLlm.apiKey,
    },
    logLevel: (env["PAI_LOG_LEVEL"] as Config["logLevel"]) ?? (fileConfig.logLevel as Config["logLevel"]) ?? "silent",
    plugins: env["PAI_PLUGINS"]?.split(",").map((s) => s.trim()) ?? fileConfig.plugins ?? ["memory", "tasks"],
    webSearchEnabled: env["PAI_WEB_SEARCH"] === "false" ? false : (fileConfig.webSearchEnabled ?? true),
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
