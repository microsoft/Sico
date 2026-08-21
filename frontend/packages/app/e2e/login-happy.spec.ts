import { expect, test } from "@playwright/test";

import { mockLoginSuccess } from "./fixtures/login-api";

// Happy-path E2E for `/login`. Backend is mocked via `page.route` because
// Playwright's `webServer` runs `vite preview` (no dev proxy), so a real
// `/api/sico/rbac/login` from `:4173` would 404. Assertions focus on URL
// transitions — the safe-next allowlist is unit-tested in @sico/shared.

test.beforeEach(async ({ page }) => {
  await mockLoginSuccess(page);
});

test("user signs in with valid credentials and lands on /digital-worker", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel(/email address/i).fill("operator@sico.local");
  // `^password$` anchors avoid colliding with the "Show password" sr-only label.
  await page.getByLabel(/^password\*?$/i).fill("operator");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/digital-worker/);
});

test("?next path is respected after sign-in", async ({ page }) => {
  await page.goto("/login?next=/some-protected");
  await page.getByLabel(/email address/i).fill("operator@sico.local");
  await page.getByLabel(/^password\*?$/i).fill("operator");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/some-protected/);
});

test("malicious ?next is rejected", async ({ page }) => {
  await page.goto("/login?next=//evil.com");
  await page.getByLabel(/email address/i).fill("operator@sico.local");
  await page.getByLabel(/^password\*?$/i).fill("operator");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/digital-worker/);
});
