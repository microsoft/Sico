import { expect, test } from "@playwright/test";

import { mockLoginCredentialsError } from "./fixtures/login-api";

// Sad-path E2E for `/login`. Locks three behavioural contracts:
//   1. Backend rejects credentials → inline error + stays on /login
//   2. ?code=401 deep link → toast + strips `code=` from URL
//   3. Client-side zod failure → inline error + NO request fired
// Backend is hermetically mocked (Task 10 pattern). Locators use
// `getByRole("textbox", { name: /…/i })` — robust to label-asterisk drift
// (T10.I2). URL regexes are anchored (T10.I1).

test("incorrect credentials render inline error and keep user on /login", async ({
  page,
}) => {
  await mockLoginCredentialsError(page);
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: /email/i })
    .fill("operator@sico.local");
  // `^password` anchors so we don't collide with "Show password" sr-only label.
  await page
    .getByRole("textbox", { name: /^password/i })
    .fill("wrong-password");

  // Wait for the 401-ish response in lockstep with the click so the
  // assertion below doesn't race the in-flight mutation (T10.I3).
  await Promise.all([
    page.waitForResponse("**/api/sico/rbac/login"),
    page.getByRole("button", { name: /continue/i }).click(),
  ]);

  // `<FieldError>` from @sico/ui renders `role="alert"` (verified in
  // packages/ui/src/components/ui/field.tsx).
  await expect(page.getByRole("alert")).toContainText(/incorrect/i);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("?code=401 deep link shows session-expired toast and strips code from URL", async ({
  page,
}) => {
  await page.goto("/login?code=401");

  await expect(page.getByText(/session expired/i)).toBeVisible();
  // The route's useEffect calls navigate({ search: { code: undefined } }),
  // so the final URL must no longer carry `code=`. Use the URL predicate
  // form so we assert on the live document URL (not a snapshot).
  await expect(page).toHaveURL((url) => !url.search.includes("code="));
});

test("client-side zod failure renders inline error and fires no API request", async ({
  page,
}) => {
  // No mock: this test asserts the request is NEVER made.
  const loginRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/sico/rbac/login")) {
      loginRequests.push(request.url());
    }
  });

  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill("notanemail");
  await page.getByRole("textbox", { name: /^password/i }).fill("123");
  await page.getByRole("button", { name: /continue/i }).click();

  // The friendly zod message is "Please enter a valid email". Lock the
  // user-visible signal ("valid email") + the "no request fired"
  // invariant; the exact wording can evolve without breaking this test.
  await expect(page.getByRole("alert").first()).toContainText(/valid email/i);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  // Lock the "no API call" invariant explicitly so a future RHF gating
  // regression can't silently false-pass.
  expect(loginRequests).toEqual([]);
});
