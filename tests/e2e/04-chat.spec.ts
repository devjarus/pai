import { test, expect } from "@playwright/test";
import { ensureOwner, loginViaAPI } from "./helpers";

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwner();
    // Use API login to avoid rate-limit on /api/auth/login (5 req/min)
    await loginViaAPI(page);
  });

  test("send a message and receive a streamed response", async ({ page }) => {
    // Find the chat textarea by placeholder
    const input = page.getByPlaceholder(/type a message/i);
    await expect(input).toBeVisible({ timeout: 5_000 });

    // Type and send
    await input.fill("Hello, how are you?");
    await input.press("Enter");

    // Wait for assistant response from mock LLM
    // Mock LLM returns: "Hello! I'm your personal AI assistant."
    await expect(
      page.getByText(/personal AI assistant/i),
    ).toBeVisible({ timeout: 15_000 });
  });
});
