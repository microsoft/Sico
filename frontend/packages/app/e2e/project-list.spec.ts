import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import { realLogin, skipWithoutCreds } from "./fixtures/real-auth";
import {
  mockBoundOrganizationAccess,
  mockSicoApi,
  seedAuth,
} from "./fixtures/seed-auth";

// E2E coverage for `/project` page states. The shared `mockSicoApi`
// catch-all is installed first; per-test `page.route` calls below
// override `/project/user_projects` with the state-specific payload
// (Playwright matches most-recently-registered first).

type ProjectFixture = {
  id: number;
  name: string;
  description: string;
  iconUrl: string;
  memberType: 1 | 2 | 3;
  agentInstances: { id: number; iconUrl: string }[];
};

function makeProject(id: number): ProjectFixture {
  return {
    id,
    name: `Project ${id}`,
    description: `Description for project ${id}`,
    iconUrl: "",
    memberType: 3,
    agentInstances: [],
  };
}

async function mockProjectsRoute(
  page: Page,
  handler: (url: URL) => {
    status?: number;
    body: unknown;
  },
): Promise<void> {
  await page.route("**/api/sico/project/user_projects*", async (route) => {
    const { status = 200, body } = handler(new URL(route.request().url()));
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.describe("project list", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockSicoApi(page);
    await mockBoundOrganizationAccess(page);
  });

  test(
    "renders first page of projects",
    { tag: ["@core", "@project"] },
    async ({ page }) => {
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({
          projects: [makeProject(1), makeProject(2), makeProject(3)],
          total: 3,
          hasNext: false,
        }),
      }));

      await page.goto("/project");
      await expect(
        page.getByRole("heading", { level: 1, name: "Projects" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /Project 1/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Project 3/ })).toBeVisible();
    },
  );

  test(
    "shows skeleton while the first page is in flight",
    { tag: ["@loading", "@project"] },
    async ({ page }) => {
      // Delay the response so the Suspense fallback (ProjectsGridSkeleton) is
      // observable. The loader fires the request but does not await it, so the
      // route mounts immediately and `<Projects>` suspends on the empty cache.
      await page.route("**/api/sico/project/user_projects*", async (route) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 2_000);
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            makeOkEnvelope({
              projects: [makeProject(1)],
              total: 1,
              hasNext: false,
            }),
          ),
        });
      });

      await page.goto("/project");
      await expect(
        page.getByRole("status", { name: "Loading projects" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /Project 1/ })).toBeVisible({
        timeout: 15_000,
      });
    },
  );

  test(
    "renders empty state when user has no projects",
    { tag: ["@key", "@project"] },
    async ({ page }) => {
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({ projects: [], total: 0, hasNext: false }),
      }));

      await page.goto("/project");
      await expect(
        page.getByRole("heading", { level: 2, name: "No projects yet" }),
      ).toBeVisible();
    },
  );

  test(
    "renders error view with Try again button on 500",
    { tag: ["@error", "@project"] },
    async ({ page }) => {
      await mockProjectsRoute(page, () => ({
        status: 500,
        body: { code: 500, msg: "server error", data: {} },
      }));

      await page.goto("/project");
      // Query client retries 3× with exp backoff (1s + 2s + 4s) before throwing
      // to the ErrorBoundary, so allow more than the default 5s assertion timeout.
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible(
        {
          timeout: 15_000,
        },
      );
    },
  );

  test(
    "infinite scroll loads more pages via sentinel",
    { tag: ["@key", "@project"] },
    async ({ page }) => {
      await page.route("**/api/sico/project/user_projects*", async (route) => {
        const url = new URL(route.request().url());
        const requestedPage = Number(url.searchParams.get("page") ?? "1");
        if (requestedPage === 1) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              makeOkEnvelope({
                projects: Array.from({ length: 3 }, (_, i) =>
                  makeProject(i + 1),
                ),
                total: 6,
                hasNext: true,
              }),
            ),
          });
          return;
        }
        // Delay page 2 so the bottom Spinner is observable.
        await new Promise((resolve) => {
          setTimeout(resolve, 2_000);
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            makeOkEnvelope({
              projects: Array.from({ length: 3 }, (_, i) => makeProject(i + 4)),
              total: 6,
              hasNext: false,
            }),
          ),
        });
      });

      await page.goto("/project");
      await expect(page.getByRole("link", { name: /Project 1/ })).toBeVisible();

      // Scroll the sentinel into view to trigger IntersectionObserver.
      await page
        .getByRole("link", { name: /Project 3/ })
        .scrollIntoViewIfNeeded();
      // Spinner is visible while page 2 is in flight (2s delay above).
      await expect(page.getByRole("link", { name: /Project 6/ })).toBeVisible();
    },
  );

  // Core path C9: creating a project. Open the dialog from the list toolbar, fill
  // the required Name, submit → POST /project → "Project created." toast + dialog
  // closes. This is the project branch's 0→1 write, previously untested end-to-end.
  test(
    "create project: filling the dialog and saving toasts success",
    {
      tag: ["@core", "@project"],
    },
    async ({ page }) => {
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({ projects: [], total: 0, hasNext: false }),
      }));
      await page.route("**/api/sico/project", async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        expect(route.request().postDataJSON()).toEqual(
          expect.objectContaining({ organizationId: 9 }),
        );
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeOkEnvelope({ id: 99 })),
        });
      });

      await page.goto("/project");
      // Two "Create Project" buttons exist (header toolbar + empty-state CTA); scope
      // to the page header so the selector is unambiguous regardless of list state.
      await page
        .locator("header")
        .getByRole("button", { name: "Create Project" })
        .click();

      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "Create Project" }),
      ).toBeVisible();
      await dialog.getByLabel("Name").fill("Aurora launch");
      await dialog.getByRole("button", { name: "Save" }).click();

      await expect(page.getByText("Project created.")).toBeVisible();
      await expect(dialog).toBeHidden();
    },
  );

  test(
    "missing organization redirects protected projects to the organization empty state",
    { tag: ["@key", "@project"] },
    async ({ page }) => {
      await mockBoundOrganizationAccess(page, { organizationIds: [] });
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({
          projects: [makeProject(1)],
          total: 1,
          hasNext: false,
        }),
      }));
      await page.goto("/project");

      await expect(page).toHaveURL(/\/organization\/members$/);
      await expect(page.getByText("No organization available")).toBeVisible();
      await expect(page.getByRole("link", { name: /Project 1/ })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: "Create Project" }),
      ).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    },
  );

  test(
    "create project: saving after an organization switch uses the selected organization",
    { tag: ["@core", "@project"] },
    async ({ page }) => {
      await mockBoundOrganizationAccess(page, { organizationIds: [9, 10] });
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({ projects: [], total: 0, hasNext: false }),
      }));
      await page.route("**/api/sico/project", async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeOkEnvelope({ id: 100 })),
        });
      });

      await page.goto("/project");
      await page.getByRole("button", { name: "Account options" }).click();
      await page.getByRole("menuitem", { name: "Switch Organization" }).hover();
      await page.getByRole("menuitemradio", { name: "SICO 2" }).click();
      await page.keyboard.press("Escape");
      await page
        .locator("header")
        .getByRole("button", { name: "Create Project" })
        .click();

      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Beta project");
      const requestPromise = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/api/sico/project" &&
          request.method() === "POST",
      );
      await dialog.getByRole("button", { name: "Save" }).click();

      expect((await requestPromise).postDataJSON()).toEqual(
        expect.objectContaining({ name: "Beta project", organizationId: 10 }),
      );
      await expect(page.getByText("Project created.")).toBeVisible();
      await expect(dialog).toBeHidden();
    },
  );

  test(
    "clicking a project card navigates to its workspace",
    { tag: ["@core", "@project"] },
    async ({ page }) => {
      // The list's primary URL contract: a card is a <Link to="/project/$id">.
      // Its accessible name is the project title, so locate by that and assert
      // the landed route.
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({
          projects: [makeProject(1), makeProject(2)],
          total: 2,
          hasNext: false,
        }),
      }));

      await page.goto("/project");
      await page.getByRole("link", { name: /Project 2/ }).click();
      await expect(page).toHaveURL(/\/project\/2(?:$|[/?])/);
    },
  );

  test(
    "create project: a failed save surfaces an error toast",
    { tag: ["@error", "@project"] },
    async ({ page }) => {
      // Symmetric to the create-success test: a 500 on POST /project must toast
      // the failure rather than silently closing or hanging.
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({ projects: [], total: 0, hasNext: false }),
      }));
      await page.route("**/api/sico/project", async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          // Empty `msg` → apiErrorMessage falls back to the component's copy
          // (a human `msg` would be surfaced verbatim instead).
          body: JSON.stringify({ code: 500, msg: "", data: {} }),
        });
      });

      await page.goto("/project");
      // Empty state → the CTA (see below) opens the same dialog; use the header
      // button here to keep this test focused on the failure branch.
      await page
        .locator("header")
        .getByRole("button", { name: "Create Project" })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Doomed project");
      await dialog.getByRole("button", { name: "Save" }).click();

      await expect(
        page.getByText("We couldn't create your project."),
      ).toBeVisible();
    },
  );

  test(
    "empty state 'Create Project' CTA opens the create dialog",
    { tag: ["@key", "@project"] },
    async ({ page }) => {
      // The empty state renders its own "Create Project" CTA (distinct from the
      // header toolbar button, which the success test uses). Clicking it opens
      // the same dialog — the zero-project entry point into the create flow.
      await mockProjectsRoute(page, () => ({
        body: makeOkEnvelope({ projects: [], total: 0, hasNext: false }),
      }));

      await page.goto("/project");
      await expect(
        page.getByRole("heading", { level: 2, name: "No projects yet" }),
      ).toBeVisible();
      // Two "Create Project" buttons render (header toolbar + empty-state CTA).
      // Target the CTA structurally — the button NOT inside <header> — via a CSS
      // exclusion, so it survives DOM-order changes (no positional `.nth`).
      await page
        .locator("button:not(header button)", { hasText: "Create Project" })
        .click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("heading", { name: "Create Project" }),
      ).toBeVisible();
    },
  );
});

// REAL environment (@real): the read-only project list on live data after a
// genuine admin login. No mocking — runs only when `SICO_E2E_URL` is set.
// Structural only: the list route mounts its h1 and does not crash. Create is a
// write op (needs a self-delete loop) so it stays mock-only above; this twin
// covers the read spine, which is the follow-up principle's first priority.
test.describe("project list @real", () => {
  test(
    "real /project renders the list shell",
    { tag: ["@core", "@project"] },
    async ({ page }) => {
      skipWithoutCreds("admin");
      await realLogin(page, "admin");

      await page.goto("/project", { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/\/project(?:\?|$)/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Projects" }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
    },
  );

  test(
    "real: clicking the first project card opens its workspace",
    { tag: ["@core", "@project"] },
    async ({ page }) => {
      // Read-only navigation twin of the mock card-click test: a real project
      // card is a <Link to="/project/$id">. Click the first one and assert we
      // land on a project workspace route (drift-proof — any numeric id). Skips
      // if the account has no projects.
      skipWithoutCreds("admin");
      await realLogin(page, "admin");
      await page.goto("/project", { waitUntil: "networkidle" });

      const firstCard = page.locator("a[href*='/project/']").first();
      test.skip(
        (await firstCard.count()) === 0,
        "No projects on this real account",
      );
      await firstCard.click();
      await expect(page).toHaveURL(/\/project\/\d+(?:$|[/?])/);
      await expect(page.getByRole("alert")).toHaveCount(0);
    },
  );
});

// REAL environment (@real) — a self-contained create→assert→delete cycle on live
// data. It makes ONE uniquely-named project, enters its workspace, and deletes
// only that project, so it never pollutes the shared environment. `afterEach`
// best-effort cleanup guards against a mid-test crash leaving litter behind.
test.describe("project list write @real", () => {
  // Unique per worker + timestamp so parallel shards / reruns never collide.
  // (Runs in the Playwright node process, where Date.now is available.)
  let tempName = "";

  // Delete the temp project by navigating into it and using the drawer's
  // Project actions → Delete. Best-effort: swallows errors so cleanup never
  // fails the test itself. Reused by the happy path and the afterEach guard.
  async function deleteProjectByName(page: Page, name: string): Promise<void> {
    const card = page.getByRole("link", { name: new RegExp(name) });
    if ((await card.count().catch(() => 0)) === 0) {
      return;
    }
    await card
      .first()
      .click()
      .catch(() => {});
    await page
      .getByRole("button", { name: "Project actions" })
      .click()
      .catch(() => {});
    await page
      .getByRole("menuitem", { name: "Delete project" })
      .click()
      .catch(() => {});
    const confirm = page.getByRole("dialog", { name: "Delete project" });
    await confirm
      .getByRole("button", { name: "Delete", exact: true })
      .click()
      .catch(() => {});
    await expect(page.getByText("Project deleted."))
      .toBeVisible({ timeout: 15_000 })
      .catch(() => {});
  }

  test.afterEach(async ({ page }) => {
    if (tempName) {
      await page.goto("/project", { waitUntil: "networkidle" }).catch(() => {});
      await deleteProjectByName(page, tempName);
    }
  });

  test(
    "create a project then delete only that project",
    { tag: ["@core", "@project"] },
    async ({ page }, testInfo) => {
      skipWithoutCreds("admin");
      tempName = `e2e-w${testInfo.workerIndex}-${Date.now().toString(36)}`;

      await realLogin(page, "admin");
      await page.goto("/project", { waitUntil: "networkidle" });

      // CREATE — the header toolbar's dialog.
      await page
        .locator("header")
        .getByRole("button", { name: "Create Project" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { name: "Create Project" }),
      ).toBeVisible();
      await dialog.getByLabel("Name").fill(tempName);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Project created.")).toBeVisible({
        timeout: 15_000,
      });

      // ASSERT its card appears in the list (real round-trip → generous timeout).
      const card = page.getByRole("link", { name: new RegExp(tempName) });
      await expect(card.first()).toBeVisible({ timeout: 15_000 });

      // DELETE only our project via its workspace drawer.
      await card.first().click();
      await expect(page).toHaveURL(/\/project\/\d+(?:$|[/?])/);
      await page.getByRole("button", { name: "Project actions" }).click();
      await page.getByRole("menuitem", { name: "Delete project" }).click();
      const confirm = page.getByRole("dialog", { name: "Delete project" });
      await expect(confirm).toBeVisible();
      await confirm
        .getByRole("button", { name: "Delete", exact: true })
        .click();

      // ASSERT it's gone: back on the list, the card is absent.
      await expect(page.getByText("Project deleted.")).toBeVisible({
        timeout: 15_000,
      });
      await page.goto("/project", { waitUntil: "networkidle" });
      await expect(
        page.getByRole("link", { name: new RegExp(tempName) }),
      ).toHaveCount(0);
      tempName = ""; // deleted cleanly → afterEach has nothing to do
    },
  );
});
