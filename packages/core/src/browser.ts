/**
 * Browser automation client — interacts with Pinchtab HTTP API.
 * Only available when PAI_BROWSER_URL is configured.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Logger } from "./types.js";

export interface BrowserNavigateOptions {
  /** URL to navigate to */
  url: string;
  /** Open in a new tab instead of the current one */
  newTab?: boolean;
  /** Wait for page to settle (ms, default: 2000) */
  waitMs?: number;
}

export interface BrowserNavigateResult {
  url: string;
  title: string;
}

export interface BrowserActionOptions {
  /** Action kind: click, type, select, scroll, hover, wait */
  kind: "click" | "type" | "select" | "scroll" | "hover" | "wait";
  /** Element reference from snapshot (e.g. "[1]") */
  ref?: string;
  /** Text to type (for kind=type) */
  text?: string;
  /** Key to press (e.g. "Enter", "Tab") */
  key?: string;
  /** Value for select dropdowns */
  value?: string;
  /** Scroll direction (for kind=scroll) */
  direction?: "up" | "down";
  /** Wait duration in ms (for kind=wait) */
  waitMs?: number;
}

export interface BrowserActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Resolve browser automation URL.
 * Priority: configUrl > PAI_BROWSER_URL env > Railway internal > Docker default > null.
 */
export function resolveBrowserUrl(configUrl?: string): string | null {
  if (configUrl) return configUrl;
  if (process.env.PAI_BROWSER_URL) return process.env.PAI_BROWSER_URL;
  // Railway internal networking
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return "http://sandbox.railway.internal:9867";
  // Docker Compose networking (same container as sandbox)
  if (process.env.PAI_DATA_DIR === "/data") return "http://sandbox:9867";
  return null;
}

/**
 * Check if the browser automation service is healthy.
 */
export async function browserHealth(url?: string): Promise<{ ok: boolean }> {
  const baseUrl = url ?? resolveBrowserUrl();
  if (!baseUrl) return { ok: false };

  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Navigate to a URL in the browser.
 */
export async function browserNavigate(
  url: string,
  opts?: Partial<Pick<BrowserNavigateOptions, "newTab" | "waitMs">>,
  logger?: Logger,
  configUrl?: string,
): Promise<BrowserNavigateResult> {
  const baseUrl = resolveBrowserUrl(configUrl);
  if (!baseUrl) {
    throw new Error("Browser not configured. Set browserUrl in Settings or PAI_BROWSER_URL env var.");
  }

  logger?.debug("Browser navigate", { url, newTab: opts?.newTab });

  const body: BrowserNavigateOptions = { url, ...opts };
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/navigate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "connection failed";
    logger?.error("Browser navigate unreachable", { error: msg });
    throw new Error(`Cannot reach browser at ${baseUrl}/navigate — ${msg}`);
  }

  // If 404 "no tabs open", retry with newTab: true to auto-create a tab
  if (res.status === 404 && !body.newTab) {
    logger?.debug("Browser navigate: no tabs open, retrying with newTab=true");
    const retryBody = { ...body, newTab: true };
    try {
      res = await fetch(`${baseUrl}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryBody),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "connection failed";
      throw new Error(`Cannot reach browser at ${baseUrl}/navigate — ${msg}`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Browser navigate failed (${res.status}): ${text}`);
  }

  return await res.json() as BrowserNavigateResult;
}

/**
 * Get interactive element snapshot (accessibility tree).
 */
export async function browserSnapshot(
  logger?: Logger,
  configUrl?: string,
): Promise<string> {
  const baseUrl = resolveBrowserUrl(configUrl);
  if (!baseUrl) {
    throw new Error("Browser not configured. Set browserUrl in Settings or PAI_BROWSER_URL env var.");
  }

  logger?.debug("Browser snapshot");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/snapshot?filter=interactive&format=text`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "connection failed";
    logger?.error("Browser snapshot unreachable", { error: msg });
    throw new Error(`Cannot reach browser at ${baseUrl}/snapshot — ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Browser snapshot failed (${res.status}): ${text}`);
  }

  return await res.text();
}

/**
 * Perform a browser action (click, type, select, scroll, etc.).
 */
export async function browserAction(
  opts: BrowserActionOptions,
  logger?: Logger,
  configUrl?: string,
): Promise<BrowserActionResult> {
  const baseUrl = resolveBrowserUrl(configUrl);
  if (!baseUrl) {
    throw new Error("Browser not configured. Set browserUrl in Settings or PAI_BROWSER_URL env var.");
  }

  logger?.debug("Browser action", { kind: opts.kind, ref: opts.ref });

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "connection failed";
    logger?.error("Browser action unreachable", { error: msg });
    throw new Error(`Cannot reach browser at ${baseUrl}/action — ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Browser action failed (${res.status}): ${text}`);
  }

  return await res.json() as BrowserActionResult;
}

/**
 * Get the full text content of the current page.
 */
export async function browserText(
  logger?: Logger,
  configUrl?: string,
): Promise<string> {
  const baseUrl = resolveBrowserUrl(configUrl);
  if (!baseUrl) {
    throw new Error("Browser not configured. Set browserUrl in Settings or PAI_BROWSER_URL env var.");
  }

  logger?.debug("Browser text extract");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/text`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "connection failed";
    logger?.error("Browser text unreachable", { error: msg });
    throw new Error(`Cannot reach browser at ${baseUrl}/text — ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Browser text failed (${res.status}): ${text}`);
  }

  return await res.text();
}

/**
 * Take a screenshot of the current page.
 * Returns base64-encoded PNG/JPEG image data.
 */
export async function browserScreenshot(
  quality?: number,
  logger?: Logger,
  configUrl?: string,
): Promise<Buffer> {
  const baseUrl = resolveBrowserUrl(configUrl);
  if (!baseUrl) {
    throw new Error("Browser not configured. Set browserUrl in Settings or PAI_BROWSER_URL env var.");
  }

  logger?.debug("Browser screenshot", { quality });

  const params = quality ? `?quality=${quality}` : "";
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/screenshot${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "connection failed";
    logger?.error("Browser screenshot unreachable", { error: msg });
    throw new Error(`Cannot reach browser at ${baseUrl}/screenshot — ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Browser screenshot failed (${res.status}): ${text}`);
  }

  // Pinchtab returns JSON { base64, format } or raw binary depending on content-type
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await res.json() as { base64?: string };
    if (!json.base64) throw new Error("Browser screenshot returned empty base64 payload");
    return Buffer.from(json.base64, "base64");
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Close all browser tabs. Call after research/swarm jobs to prevent tab leak.
 */
export async function browserCloseAllTabs(
  logger?: Logger,
  configUrl?: string,
): Promise<void> {
  const baseUrl = resolveBrowserUrl(configUrl);
  if (!baseUrl) return;

  try {
    // List all pages
    const listRes = await fetch(`${baseUrl}/list_pages`, { signal: AbortSignal.timeout(5000) });
    if (!listRes.ok) return;
    const pages = await listRes.json() as Array<{ id: string }>;

    // Close all except the first (keep one tab alive)
    for (const page of pages.slice(1)) {
      await fetch(`${baseUrl}/close_page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: page.id }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    if (pages.length > 1) {
      logger?.debug("Browser cleanup: closed tabs", { closed: pages.length - 1 });
    }
  } catch {
    // Non-critical — browser may not be running
  }
}

// ---- Shared Browser Tool Definitions ----

/** Minimal context needed to create browser tools */
export interface BrowserToolContext {
  logger: Logger;
  browserUrl?: string;
  /** Store artifact and return its ID. If omitted, browse_screenshot is excluded. */
  storeArtifact?: (name: string, mimeType: string, data: Buffer) => string;
}

/**
 * Create AI SDK tool definitions for browser automation.
 * Returns empty object if browser is not configured.
 * Used by assistant, research, and swarm plugins.
 */
export function createBrowserTools(ctx: BrowserToolContext) {
  const url = resolveBrowserUrl(ctx.browserUrl);
  if (!url) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
    browse_navigate: tool({
      description: "Navigate the browser to a URL. Use this to open web pages that require JavaScript rendering, login-gated content, or SPAs that can't be fetched as plain HTML. After navigating, use browse_snapshot to see interactive elements or browse_text to read page content.",
      inputSchema: z.object({
        url: z.string().url().describe("URL to navigate to"),
        newTab: z.boolean().optional().describe("Open in a new tab (default: false)"),
      }),
      execute: async ({ url: targetUrl, newTab }) => {
        try {
          const result = await browserNavigate(targetUrl, { newTab }, ctx.logger, ctx.browserUrl);
          return { ok: true, url: result.url, title: result.title };
        } catch (err) {
          return { ok: false, error: `Navigation failed: ${err instanceof Error ? err.message : "unknown error"}` };
        }
      },
    }),

    browse_snapshot: tool({
      description: "Get a snapshot of interactive elements on the current browser page (buttons, links, inputs, etc.). Each element has a reference like [1], [2] etc. that you can use with browse_action to interact with them. Call this after browse_navigate to see what you can click or fill in.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          let snapshot = await browserSnapshot(ctx.logger, ctx.browserUrl);
          if (snapshot.length > 3000) {
            snapshot = snapshot.slice(0, 3000) + "\n\n[truncated — page has many interactive elements]";
          }
          return snapshot || "[empty] No interactive elements found on this page.";
        } catch (err) {
          return `Snapshot failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),

    browse_action: tool({
      description: "Perform an action in the browser — click a button/link, type text into an input, select a dropdown option, scroll, or hover. Use element references from browse_snapshot (e.g. ref='[1]').",
      inputSchema: z.object({
        kind: z.enum(["click", "type", "select", "scroll", "hover", "wait"]).describe("Action type"),
        ref: z.string().optional().describe("Element reference from snapshot (e.g. '[1]')"),
        text: z.string().optional().describe("Text to type (for kind=type)"),
        key: z.string().optional().describe("Key to press (e.g. 'Enter', 'Tab')"),
        value: z.string().optional().describe("Value for select dropdowns"),
        direction: z.enum(["up", "down"]).optional().describe("Scroll direction"),
      }),
      execute: async ({ kind, ref, text, key, value, direction }) => {
        try {
          const result = await browserAction(
            { kind, ref, text, key, value, direction },
            ctx.logger,
            ctx.browserUrl,
          );
          return result;
        } catch (err) {
          return { ok: false, error: `Action failed: ${err instanceof Error ? err.message : "unknown error"}` };
        }
      },
    }),

    browse_text: tool({
      description: "Extract the full text content of the current browser page. Use this to read page content after navigating. More complete than a simple fetch for JS-rendered pages.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          let text = await browserText(ctx.logger, ctx.browserUrl);
          if (text.length > 4000) {
            text = text.slice(0, 4000) + "\n\n[truncated — use a more specific approach for full content]";
          }
          return text || "[empty] No text content found on this page.";
        } catch (err) {
          return `Text extraction failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      },
    }),
  };

  // Only include screenshot if artifact storage is available
  if (ctx.storeArtifact) {
    const store = ctx.storeArtifact;
    tools.browse_screenshot = tool({
      description: "Take a screenshot of the current browser page. Use when you need to see what the page looks like visually, or to capture visual content the user asks about. The screenshot is saved as an artifact.",
      inputSchema: z.object({
        quality: z.number().min(1).max(100).optional().describe("JPEG quality (1-100, default: 80)"),
      }),
      execute: async ({ quality }) => {
        try {
          const data = await browserScreenshot(quality, ctx.logger, ctx.browserUrl);
          const artifactId = store("screenshot.png", "image/png", data);
          return {
            ok: true,
            artifactId,
            downloadUrl: `/api/artifacts/${artifactId}`,
            size: data.length,
          };
        } catch (err) {
          return { ok: false, error: `Screenshot failed: ${err instanceof Error ? err.message : "unknown error"}` };
        }
      },
    });
  }

  return tools;
}
