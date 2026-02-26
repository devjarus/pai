import { test, expect } from "@playwright/test";
import { ensureOwner, loginViaAPI, waitForServer } from "./helpers";

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await ensureOwner();
    await loginViaAPI(page);
  });

  test("save model and API key, verify persistence and API response", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByText("Configuration")).toBeVisible({
      timeout: 5_000,
    });

    // Enter edit mode
    await page.getByRole("button", { name: "Edit" }).click();

    // Change model (placeholder "llama3.2" from Ollama preset)
    const modelInput = page.getByPlaceholder("llama3.2");
    await modelInput.clear();
    await modelInput.fill("new-test-model");

    // Enter API key
    const apiKeyRow = page
      .locator("div")
      .filter({ hasText: /^API Key/ })
      .last();
    const apiKeyInput = apiKeyRow.locator('input[type="password"]');
    await expect(apiKeyInput).toBeVisible({ timeout: 5_000 });
    await apiKeyInput.fill("sk-test-key-12345");

    // Save both at once (single reinitialize)
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Configuration saved/i)).toBeVisible({
      timeout: 5_000,
    });

    // Wait for server to stabilize after reinitialize
    await waitForServer();

    // Verify config API returns hasApiKey: true and hides actual key
    const config = await page.evaluate(async () => {
      const res = await fetch("/api/config");
      return res.json();
    });
    expect(config.llm.hasApiKey).toBe(true);
    expect(config.llm.apiKey).toBeUndefined();

    // Reload to verify UI persistence
    await page.goto("/settings");
    await expect(page.getByText("Configuration")).toBeVisible({
      timeout: 5_000,
    });

    // Model should show the new value
    await expect(page.getByText("new-test-model")).toBeVisible({
      timeout: 5_000,
    });

    // Enter edit mode to check API key placeholder
    await page.getByRole("button", { name: "Edit" }).click();
    const updatedRow = page
      .locator("div")
      .filter({ hasText: /^API Key/ })
      .last();
    const updatedInput = updatedRow.locator("input");
    await expect(updatedInput).toHaveAttribute("placeholder", /Key saved/i, {
      timeout: 5_000,
    });
  });
});
