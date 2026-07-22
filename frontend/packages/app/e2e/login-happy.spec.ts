/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
