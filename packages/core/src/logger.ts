import type { LogLevel, Logger } from "./types.js";

const LEVELS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export function createLogger(level: LogLevel = "silent"): Logger {
  const threshold = LEVELS[level];
  const emit = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] > threshold) return;
    const entry = { ts: new Date().toISOString(), level: lvl, msg, ...data };
    process.stderr.write(JSON.stringify(entry) + "\n");
  };
  return {
    error: (msg, data) => emit("error", msg, data),
    warn: (msg, data) => emit("warn", msg, data),
    info: (msg, data) => emit("info", msg, data),
    debug: (msg, data) => emit("debug", msg, data),
  };
}
