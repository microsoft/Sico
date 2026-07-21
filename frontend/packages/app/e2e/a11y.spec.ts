import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test, type TestInfo } from "@playwright/test";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// axe-core sweep + focus-first-`<h1>` contract on authenticated routes.

const AXE_RULES = [
  "page-has-heading-one",
  "landmark-one-main",
  "color-contrast",
];

// Attaches violations as JSON before asserting — failure reports show
// the concrete rules + nodes without a local re-run.
async function expectNoAxeViolations(
  page: Page,
  info: TestInfo,
): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withRules(AXE_RULES)
    .analyze();
  if (violations.length > 0) {
    await info.attach("axe-violations.json", {
      body: JSON.stringify(violations, null, 2),
      contentType: "application/json",
    });
  }
  expect(violations).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // `mockSicoApi` is always safe; `seedAuth` lives in the authed sub-tests
  // because `routes/login.tsx#beforeLoad` now redirects authed users to
  // `/digital-worker`, so the `/login` axe target must run unauthenticated.
  await mockSicoApi(page);
});

test.describe("a11y route sweep (axe-core)", () => {
  test("/login passes axe (heading, landmark, contrast)", async ({
    page,
  }, info) => {
    await page.goto("/login");
    await expect(
      // `/login` page-h1 is owned by LoginForm now that LoginLayout
      // provides the SICO brand surface via a logo image. Exact-match
      // to avoid matching future headings that contain "Sign in".
      page.getByRole("heading", { level: 1, name: /^Sign in$/ }),
    ).toBeVisible();
    await expectNoAxeViolations(page, info);
  });

  test("/digital-worker passes axe (heading, landmark, contrast)", async ({
    page,
  }, info) => {
    await seedAuth(page);
    await page.goto("/digital-worker");
    await expect(
      page.getByRole("heading", { level: 1, name: "Digital Worker" }),
    ).toBeVisible();
    await expectNoAxeViolations(page, info);
  });

  test("deliberate unknown path passes axe (heading, landmark, contrast)", async ({
    page,
  }, info) => {
    await page.goto("/this-route-does-not-exist");
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
    await expectNoAxeViolations(page, info);
  });
});

test("focus moves to <h1> on authenticated route change (/digital-worker → /profile)", async ({
  page,
}) => {
  await seedAuth(page);
  await page.goto("/digital-worker");
  await expect(
    page.getByRole("heading", { level: 1, name: "Digital Worker" }),
  ).toBeVisible();

  // `page.goto` is hard navigation: `useFocusFirstHeading` focuses
  // the new <h1> on mount via the `resolvedLocation` fallback.
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { level: 1, name: "Profile" }),
  ).toBeVisible();

  // `document.activeElement` is page-context — poll until effect fires.
  await expect
    .poll(async () =>
      page.evaluate(() => document.activeElement?.tagName ?? null),
    )
    .toBe("H1");
});
