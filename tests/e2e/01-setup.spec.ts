import { test, expect } from "@playwright/test";

test.describe("Setup wizard", () => {
  test("first boot shows setup page and creates owner", async ({ page }) => {
    // First boot — no owner exists → should redirect to /setup
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup/, { timeout: 10_000 });

    // Step 1: Account creation
    await expect(page.getByText("Set up pai")).toBeVisible();

    await page.getByPlaceholder("What should I call you?").fill("Test Owner");
    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("At least 8 characters").fill("testpass123");
    await page.getByPlaceholder("Repeat your password").fill("testpass123");

    await page.getByRole("button", { name: "Create Account" }).click();

    // Step 2: LLM setup — should show "Connect your AI"
    await expect(page.getByText("Connect your AI")).toBeVisible({ timeout: 10_000 });

    // On localhost, should show both options
    await expect(page.getByText("Run locally")).toBeVisible();
    await expect(page.getByText("Use a cloud provider")).toBeVisible();

    // Verify cloud provider flow renders correctly
    await page.getByText("Use a cloud provider").click();
    await expect(page.getByText("Ollama Cloud")).toBeVisible();
    await expect(page.getByText("OpenAI")).toBeVisible();
    await expect(page.getByText("Anthropic")).toBeVisible();
    await expect(page.getByText("Google AI")).toBeVisible();

    // Test back navigation
    await page.getByText("← Back").click();
    await expect(page.getByText("Run locally")).toBeVisible();

    // Verify local Ollama flow renders correctly
    await page.getByText("Run locally").click();
    await expect(page.getByText("Set up Ollama on your machine")).toBeVisible();
    await expect(page.getByRole("button", { name: "Test Connection" })).toBeVisible();
    await page.getByText("← Back").click();

    // Skip LLM setup to preserve mock config for subsequent tests
    await page.getByText("Skip").click();

    // Step 3: Personal intro
    await expect(page.getByText("Welcome to pai")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Tell me a bit about yourself")).toBeVisible();

    // Skip intro
    await page.getByText("Skip for now").click();

    // Should redirect to inbox
    await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
  });
});
