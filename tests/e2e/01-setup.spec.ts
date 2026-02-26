import { test, expect } from "@playwright/test";

test.describe("Setup wizard", () => {
  test("first boot shows setup page and creates owner", async ({ page }) => {
    // First boot — no owner exists → should redirect to /setup
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup/, { timeout: 10_000 });

    // Verify page title
    await expect(page.getByText("Set up pai")).toBeVisible();

    // Fill in the setup form (labels lack htmlFor — use placeholders)
    await page.getByPlaceholder("What should I call you?").fill("Test Owner");
    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("At least 8 characters").fill("testpass123");
    await page.getByPlaceholder("Repeat your password").fill("testpass123");

    // Submit
    await page.getByRole("button", { name: "Create Account" }).click();

    // Should redirect to chat after setup completes
    await expect(page).toHaveURL(/\/chat/, { timeout: 15_000 });
  });
});
