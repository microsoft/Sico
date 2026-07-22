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
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";
import {
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
} from "@sico/shared/utils/local-storage.ts";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// E2E for the Sidebar composer. The only authenticated page available
// pre-F3 is `/digital-worker`, so flows that require
// `/digital-worker/$agentId` data are `test.skip`-ed pending F3.

const AUTHED_PAGE = "/digital-worker";

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

// 1. Active highlight survives refresh.
//    Needs `/digital-worker` route — `useActiveNav` only matches `/digital-worker`/`/project`.
test.skip("DW nav has aria-current=page on first paint after reload", () => {
  // TODO: unskip after F3 lands /digital-worker routes.
});

// 2. Collapse toggle — session-local, reload resets to expanded.
test("collapse toggle changes width and resets after reload", async ({
  page,
}) => {
  await page.goto(AUTHED_PAGE);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav).toBeVisible();
  await expect(nav).not.toHaveAttribute("data-collapsed", "true");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(nav).toHaveAttribute("data-collapsed", "true");

  await page.reload();
  const navAfter = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navAfter).toBeVisible();
  await expect(navAfter).not.toHaveAttribute("data-collapsed", "true");
});

// 3. Collapsed-state Logo hover reveals toggle.
test("collapsed sidebar hides toggle until Logo hover", async ({ page }) => {
  await page.goto(AUTHED_PAGE);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();

  const expandBtn = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expandBtn).toBeHidden();

  await page.getByTestId("sidebar-logo").hover();
  await expect(expandBtn).toBeVisible();
});

// 4. DW list renders ≤ 5. Needs `/digital-worker/$agentId` route since each
//    row is a `<Link to="/digital-worker/$agentId">` — TanStack Router throws on
//    unknown routes during render.
test.skip("DW preview list renders at most 5 agents", () => {
  // TODO: unskip after F3 lands /digital-worker routes.
  // Mock plan: page.route("**/api/sico/agents*", fulfill paginatedSchema
  // envelope with 200 items) → expect list <li> count === 5.
  void makeOkEnvelope;
});

// 5. Logout success → POST sent with Authorization → redirect → back
//    stays on /login.
test("logout posts with bearer token and replaces history", async ({
  page,
}) => {
  await page.goto(AUTHED_PAGE);

  let logoutRequest:
    | { method: string; authorization: string | null }
    | undefined;
  await page.route("**/api/sico/rbac/logout", async (route) => {
    const req = route.request();
    logoutRequest = {
      method: req.method(),
      authorization: req.headers().authorization ?? null,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeOkEnvelope({})),
    });
  });

  await page.getByRole("button", { name: "Account options" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login(\?|$)/);

  expect(logoutRequest?.method).toBe("POST");
  expect(logoutRequest?.authorization).toBe("Bearer tok");

  // replace:true → browser back must not return to the authed page.
  // With a single replaced entry, `goBack()` lands on `about:blank`
  // (no prior history); the contract is "not the authed page", not
  // "still /login".
  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`${AUTHED_PAGE}(\\?|$)`));
});

// 6. Logout server failure is non-blocking.
test("logout still redirects and clears LS when server returns 500", async ({
  page,
}) => {
  await page.goto(AUTHED_PAGE);

  await page.route("**/api/sico/rbac/logout", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, msg: "server error" }),
    });
  });

  await page.getByRole("button", { name: "Account options" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login(\?|$)/);

  const [token, user] = await page.evaluate(
    ([tokenKey, userKey]) => [
      // eslint-disable-next-line no-restricted-syntax -- e2e probe runs in browser context, wrapper unavailable
      localStorage.getItem(tokenKey as string),
      // eslint-disable-next-line no-restricted-syntax -- e2e probe runs in browser context, wrapper unavailable
      localStorage.getItem(userKey as string),
    ],
    [AUTH_TOKEN_LS, AUTH_USER_LS],
  );
  expect(token).toBeNull();
  expect(user).toBeNull();
});
