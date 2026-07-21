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
