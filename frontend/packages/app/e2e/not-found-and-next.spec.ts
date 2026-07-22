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

import { mockSicoApi } from "./fixtures/seed-auth";

// 404 + `next=` preservation + marketing `/` (all unauthenticated).
// `mockSicoApi` turns an accidental fetch into a meaningful assertion
// failure rather than `ECONNREFUSED`.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
    localStorage.clear();
  });
  await mockSicoApi(page);
});

test.describe("404 + next= preservation + marketing /", () => {
  test("unknown path renders <NotFound>", async ({ page }) => {
    await page.goto("/this/does/not/exist");

    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/this\/does\/not\/exist$/);
  });

  test("unauthenticated visit to /digital-worker redirects to /login?code=401&next=%2Fdigital-worker", async ({
    page,
  }) => {
    await page.goto("/digital-worker");

    // The redirect first lands with `?code=401&next=…` (auth signal).
    await page.waitForURL(
      /\/login\?(?=.*\bcode=401\b)(?=.*\bnext=%2Fdigital-worker\b)/,
    );

    // `routes/login.tsx#useEffect` then fires the toast and strips `code=`,
    // leaving `next=` intact. Negative lookahead asserts the strip happened.
    await expect(page).toHaveURL(
      /\/login\?(?=.*\bnext=%2Fdigital-worker\b)(?!.*\bcode=)/,
    );
  });

  test("marketing / falls through to 404 inside SPA", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
