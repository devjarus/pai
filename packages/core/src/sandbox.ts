/**
 * Sandbox client — executes code in an isolated Docker sidecar.
 * Only available when PAI_SANDBOX_URL is configured.
 */

import type { Logger } from "./types.js";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: Array<{ name: string; data: string; size: number }>;
}

export interface SandboxOptions {
  language: "python" | "node";
  code: string;
  timeout?: number;
}

/**
 * Resolve sandbox URL.
 * Priority: configUrl > PAI_SANDBOX_URL env > Railway internal > Docker default > null.
 * Pass `config.sandboxUrl` when available to avoid needing env vars.
 */
export function resolveSandboxUrl(configUrl?: string): string | null {
  if (configUrl) return configUrl;
  if (process.env.PAI_SANDBOX_URL) return process.env.PAI_SANDBOX_URL;
  // Railway internal networking (service named "sandbox", fixed port 8888)
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return "http://sandbox.railway.internal:8888";
  // Docker Compose networking (container named "sandbox" in docker-compose.yml)
  if (process.env.PAI_DATA_DIR === "/data") return "http://sandbox:8888";
  return null;
}

/**
 * Check if the sandbox is available and healthy.
 */
export async function sandboxHealth(url?: string): Promise<{ ok: boolean; languages?: string[] }> {
  const baseUrl = url ?? resolveSandboxUrl();
  if (!baseUrl) return { ok: false };

  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false };
    return await res.json() as { ok: boolean; languages?: string[] };
  } catch {
    return { ok: false };
  }
}

/**
 * Execute code in the sandbox sidecar.
 * Throws if sandbox is not configured or execution fails catastrophically.
 */
export async function runInSandbox(options: SandboxOptions, logger?: Logger, configUrl?: string): Promise<SandboxResult> {
  const baseUrl = resolveSandboxUrl(configUrl);
  if (!baseUrl) {
    throw new Error("Sandbox not configured. Set sandboxUrl in Settings or PAI_SANDBOX_URL env var.");
  }

  const timeout = options.timeout ?? 30;
  const fetchTimeout = (timeout + 10) * 1000; // grace period

  logger?.debug("Sandbox execution starting", {
    language: options.language,
    codeLength: options.code.length,
    timeout,
  });

  const startMs = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: options.language,
        code: options.code,
        timeout,
      }),
      signal: AbortSignal.timeout(fetchTimeout),
    });
  } catch (err) {
    const error = `Cannot reach sandbox at ${baseUrl}/run — ${err instanceof Error ? err.message : "connection failed"}. Check that the sandbox service is running and accessible.`;
    logger?.error("Sandbox unreachable", { error: err instanceof Error ? err.message : "connection failed" });
    throw new Error(error);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "unknown error");
    logger?.error("Sandbox HTTP error", { status: res.status, body: body.slice(0, 500) });
    throw new Error(`Sandbox request failed (${res.status}): ${body}`);
  }

  const result = await res.json() as SandboxResult;
  const durationMs = Date.now() - startMs;
  const meta = {
    language: options.language,
    exitCode: result.exitCode,
    stdoutLen: result.stdout.length,
    stderrLen: result.stderr.length,
    fileCount: result.files.length,
    durationMs,
  };

  if (result.exitCode === 0) {
    logger?.debug("Sandbox execution complete", meta);
  } else {
    logger?.warn("Sandbox non-zero exit", meta);
  }

  return result;
}
