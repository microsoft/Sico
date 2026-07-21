import { expect, test } from "@playwright/test";

// `/` has no `_authed` index child, so it falls through to <NotFound>
// rather than redirecting. Hit `/digital-worker` to exercise the redirect.
test("unauthenticated visit to a protected route redirects to /login", async ({
  page,
}) => {
  await page.goto("/digital-worker");
  await expect(page).toHaveURL(/\/login/);
});
