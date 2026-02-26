import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

const TEST_PORT = process.env.PAI_TEST_PORT ?? "3199";
export const BASE = `http://127.0.0.1:${TEST_PORT}`;

/**
 * Ensure an owner account exists (idempotent).
 * Uses direct fetch (Node.js) to avoid needing a page context.
 */
export async function ensureOwner(): Promise<void> {
  const statusRes = await fetch(`${BASE}/api/auth/status`);
  const { setup } = await statusRes.json();

  if (setup) {
    await fetch(`${BASE}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Owner",
        email: "test@example.com",
        password: "testpass123",
      }),
    });
  }
}

/**
 * Login via the UI form. Waits for redirect to /chat.
 */
export async function loginViaUI(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill("test@example.com");
  await page.getByPlaceholder("Your password").fill("testpass123");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/chat/, { timeout: 10_000 });
}

/**
 * Login via fetch from within the browser context (uses browser cookies).
 * Avoids consuming rate-limit on the login endpoint from repeated UI logins.
 */
export async function loginViaAPI(page: Page): Promise<void> {
  await page.context().clearCookies();
  // Navigate to app first so fetch has a valid origin
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async () => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "testpass123",
      }),
    });
    return { ok: res.ok, status: res.status };
  });

  if (!result.ok) {
    throw new Error(`Login API failed with status ${result.status}`);
  }

  // Navigate to chat — cookies are set from the fetch above
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat/, { timeout: 10_000 });
}

/**
 * Wait for the PAI server to be healthy (polls /api/health).
 * Useful after operations that trigger reinitialize().
 */
export async function waitForServer(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${BASE} did not become healthy within ${timeoutMs}ms`);
}
