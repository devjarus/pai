/**
 * Sandbox client — executes code in an isolated Docker sidecar.
 * Only available when PAI_SANDBOX_URL is configured.
 */

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
 * Resolve sandbox URL from environment.
 * Returns null if sandbox is not configured.
 */
export function resolveSandboxUrl(): string | null {
  return process.env.PAI_SANDBOX_URL || null;
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
export async function runInSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const baseUrl = resolveSandboxUrl();
  if (!baseUrl) {
    throw new Error("Sandbox not configured. Set PAI_SANDBOX_URL to enable code execution.");
  }

  const timeout = options.timeout ?? 30;
  const fetchTimeout = (timeout + 10) * 1000; // grace period

  const res = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: options.language,
      code: options.code,
      timeout,
    }),
    signal: AbortSignal.timeout(fetchTimeout),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "unknown error");
    throw new Error(`Sandbox request failed (${res.status}): ${body}`);
  }

  return await res.json() as SandboxResult;
}
