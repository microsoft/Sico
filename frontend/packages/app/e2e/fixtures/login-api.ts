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
// TODO(T15): collapse to a single barrel import from `@sico/shared` once
// the package surface is swept; `mockLoginSuccess` was added in Task 10
// before the barrel normalisation and is left untouched per surgical-edit
// policy.
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

// Stub `POST /api/sico/rbac/login` with the canonical success envelope.
// E2E asserts the frontend reaction (router navigation + LS seed via the
// success callback) rather than backend auth, so the credentials in the
// form are inputs of convenience.
//
// `user.roles: null` mirrors the live `microsoft/sico` backend shape for
// the `operator@sico.local` seed account (dogfood QA Round 1 FIND-1).
// The auth schema transform coerces this to `[]` downstream.
export async function mockLoginSuccess(page: Page): Promise<void> {
  await page.route("**/api/sico/rbac/login", async (route) => {
    // Guard against CORS preflight / other methods reaching the stub.
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeOkEnvelope({
          tokenInfo: {
            accessToken: "stub-access-token",
            // epoch-seconds; schema rejects values > 2_000_000_000 (~2033)
            // to catch accidental millisecond payloads.
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
          user: { id: 1, email: "operator@sico.local", roles: null },
        }),
      ),
    });
  });
}

// Stub `POST /api/sico/rbac/login` with a *200 OK + non-zero envelope code*
// — the wire shape that `loginApi` (packages/shared/.../services/login-api.ts)
// classifies as `LoginCredentialsError`. The `code` is any non-zero value
// that isn't `CLIENT_NETWORK_ERROR_CODE` (600); the form copy is fixed by
// `<LoginForm>` regardless of `msg`.
//
// No `data` key — the live `microsoft/sico` backend omits it on
// credential-failure envelopes (dogfood QA Round 1 FIND-2). The envelope
// schema accepts a missing `data` so this passes axios interceptor parse
// and reaches the `code !== 0` branch in `loginApi`.
export async function mockLoginCredentialsError(page: Page): Promise<void> {
  await page.route("**/api/sico/rbac/login", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // No `makeErrorEnvelope` helper exists in `@sico/shared/schemas/api`;
      // build the envelope inline to keep this fixture additive (T15 can
      // promote a helper if a 2nd consumer appears).
      body: JSON.stringify({
        code: 101008,
        msg: "invalid credentials",
      }),
    });
  });
}
