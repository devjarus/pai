import { test, expect } from "@playwright/test";
import { ensureOwner, loginViaAPI } from "./helpers";

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwner();
    // Use API login to avoid rate-limit on /api/auth/login (10 req/min)
    await loginViaAPI(page);
  });

  test("send a message and receive a streamed response", async ({ page }) => {
    // Find the assistant-ui composer input
    const input = page.getByPlaceholder(/send a message/i);
    await expect(input).toBeVisible({ timeout: 10_000 });

    // Type into the composer using keyboard (more reliable than fill with assistant-ui)
    await input.click();
    await page.keyboard.type("Hello, how are you?");

    // Click the send button (more reliable than Enter with assistant-ui's composer)
    const sendButton = page.getByRole("button", { name: /send message/i });
    await sendButton.click();

    // Wait for assistant response from mock LLM
    // Mock LLM returns: "Hello! I am your personal AI assistant."
    await expect(
      page.getByText(/personal AI assistant/i),
    ).toBeVisible({ timeout: 15_000 });
  });
});
