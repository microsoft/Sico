import { expect, test } from "@playwright/test";
import { AUTH_TOKEN_LS } from "@sico/shared/utils/local-storage.ts";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// Authenticated routing E2E. With identity in LS the SPA must NOT call
// `/api/sico/me` — that contract is what this suite locks in.

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test("hard-reload on /digital-worker stays on /digital-worker (no /me request)", async ({
  page,
}) => {
  const meRequests: string[] = [];
  page.on("request", (request) => {
    // Anchor with `/`/`?`/end so we don't over-match `/me-anything`.
    if (/\/api\/sico\/me(\/|\?|$)/.test(request.url())) {
      meRequests.push(request.url());
    }
  });

  await page.goto("/digital-worker");
  await expect(
    page.getByRole("heading", { level: 1, name: "Digital Worker" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/digital-worker$/);

  // Hard reload — addInitScript re-runs, LS still seeded.
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Digital Worker" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/digital-worker$/);

  // No polling/SSE/ws today, so networkidle resolves deterministically.
  await page.waitForLoadState("networkidle");
  expect(meRequests).toEqual([]);
});

test("back/forward across <Link> navigation preserves history", async ({
  page,
}) => {
  await page.goto("/this-route-does-not-exist");
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Digital Worker" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/digital-worker$/);

  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/this-route-does-not-exist$/);

  await page.goForward();
  await expect(
    page.getByRole("heading", { level: 1, name: "Digital Worker" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/digital-worker$/);
});

test("deep-link to /digital-worker?foo=bar preserves search params", async ({
  page,
}) => {
  await page.goto("/digital-worker?foo=bar");
  await expect(
    page.getByRole("heading", { level: 1, name: "Digital Worker" }),
  ).toBeVisible();

  await expect(page).toHaveURL(/\/digital-worker\?foo=bar$/);

  // Sanity-check the LS seed survived navigation.
  const token = await page.evaluate(
    // eslint-disable-next-line no-restricted-syntax -- e2e probe runs in browser context, wrapper unavailable
    (key) => localStorage.getItem(key),
    AUTH_TOKEN_LS,
  );
  expect(token).toBe("tok");
});
