import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LogFileOptions, LogLevel, Logger } from "./types.js";

const LEVELS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

function rotateIfNeeded(logPath: string, maxBytes: number): void {
  try {
    const stat = statSync(logPath);
    if (stat.size >= maxBytes) {
      renameSync(logPath, logPath + ".1");
    }
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
}

export function createLogger(level: LogLevel = "silent", file?: LogFileOptions): Logger {
  const threshold = LEVELS[level];

  let logPath: string | undefined;
  let fileThreshold = 0;

  if (file) {
    mkdirSync(file.dir, { recursive: true });
    logPath = join(file.dir, "pai.log");
    fileThreshold = LEVELS[file.level ?? "info"];
    rotateIfNeeded(logPath, file.maxBytes ?? DEFAULT_MAX_BYTES);
  }

  const emit = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    const lvlNum = LEVELS[lvl];
    const entry = JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...data }) + "\n";

    if (lvlNum <= threshold) {
      process.stderr.write(entry);
    }

    if (logPath && lvlNum <= fileThreshold) {
      appendFileSync(logPath, entry);
    }
  };

  return {
    error: (msg, data) => emit("error", msg, data),
    warn: (msg, data) => emit("warn", msg, data),
    info: (msg, data) => emit("info", msg, data),
    debug: (msg, data) => emit("debug", msg, data),
  };
}
