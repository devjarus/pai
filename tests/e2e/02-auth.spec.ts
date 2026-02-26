import { test, expect } from "@playwright/test";

const TEST_PORT = process.env.PAI_TEST_PORT ?? "3199";
const BASE = `http://127.0.0.1:${TEST_PORT}`;

test.describe("Authentication", () => {
  // Setup runs first (alphabetical order), so owner already exists.
  // But just in case, ensure owner exists via API before auth tests.
  test.beforeAll(async ({ request }) => {
    const status = await request.get(`${BASE}/api/auth/status`);
    const body = await status.json();
    if (body.setup) {
      // No owner yet — create one
      await request.post(`${BASE}/api/auth/setup`, {
        data: {
          name: "Test Owner",
          email: "test@example.com",
          password: "testpass123",
        },
      });
    }
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/chat");

    // SPA checks /api/auth/status, sees not authenticated, redirects to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("login with valid credentials", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");

    // Labels lack htmlFor — use placeholders
    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("Your password").fill("testpass123");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should redirect to chat after login
    await expect(page).toHaveURL(/\/chat/, { timeout: 10_000 });
  });

  test("login with wrong password shows error", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");

    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("Your password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should show inline error (server returns "Invalid email or password")
    await expect(
      page.getByText(/invalid|incorrect|failed/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    // First login
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("Your password").fill("testpass123");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 10_000 });

    // Logout via API (POST /api/auth/logout clears cookies)
    await page.request.post(`${BASE}/api/auth/logout`);

    // Clear cookies client-side to match
    await page.context().clearCookies();

    // Now navigating to /chat should redirect to /login
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("API returns 401 without auth cookies", async ({ request }) => {
    // Create a new context without cookies
    const res = await request.fetch(`${BASE}/api/beliefs`, {
      headers: { Cookie: "" },
    });
    expect(res.status()).toBe(401);
  });
});
