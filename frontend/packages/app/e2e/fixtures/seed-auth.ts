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
