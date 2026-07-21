import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

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

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test("renders first page of projects", async ({ page }) => {
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
});

test("shows skeleton while the first page is in flight", async ({ page }) => {
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
});

test("renders empty state when user has no projects", async ({ page }) => {
  await mockProjectsRoute(page, () => ({
    body: makeOkEnvelope({ projects: [], total: 0, hasNext: false }),
  }));

  await page.goto("/project");
  await expect(
    page.getByRole("heading", { level: 2, name: "No projects yet" }),
  ).toBeVisible();
});

test("renders error view with Try again button on 500", async ({ page }) => {
  await mockProjectsRoute(page, () => ({
    status: 500,
    body: { code: 500, msg: "server error", data: {} },
  }));

  await page.goto("/project");
  // Query client retries 3× with exp backoff (1s + 2s + 4s) before throwing
  // to the ErrorBoundary, so allow more than the default 5s assertion timeout.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
});

test("infinite scroll loads more pages via sentinel", async ({ page }) => {
  await page.route("**/api/sico/project/user_projects*", async (route) => {
    const url = new URL(route.request().url());
    const requestedPage = Number(url.searchParams.get("page") ?? "1");
    if (requestedPage === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          makeOkEnvelope({
            projects: Array.from({ length: 3 }, (_, i) => makeProject(i + 1)),
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
  await page.getByRole("link", { name: /Project 3/ }).scrollIntoViewIfNeeded();
  // Spinner is visible while page 2 is in flight (2s delay above).
  await expect(page.getByRole("link", { name: /Project 6/ })).toBeVisible();
});
