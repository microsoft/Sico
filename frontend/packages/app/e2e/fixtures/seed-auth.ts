import { type Page } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
} from "@sico/shared/utils/local-storage.ts";

// Seed the auth triple via `addInitScript` so the SPA starts logged in.
// Re-runs on every navigation.
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ tokenKey, userKey, expiresAtKey }) => {
      // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
      localStorage.setItem(tokenKey, "tok");
      // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
      localStorage.setItem(
        userKey,
        JSON.stringify({ id: 1, email: "a@b.test", roles: [] }),
      );
      // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
      localStorage.setItem(
        expiresAtKey,
        String(Math.floor(Date.now() / 1000) + 3600),
      );
    },
    {
      tokenKey: AUTH_TOKEN_LS,
      userKey: AUTH_USER_LS,
      expiresAtKey: AUTH_EXPIRES_AT_LS,
    },
  );
}

// Defensive stub so an accidental fetch can't reach the real backend.
export async function mockSicoApi(page: Page): Promise<void> {
  await page.route("**/api/sico/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeOkEnvelope({})),
    });
  });
}
