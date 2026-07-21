import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// Per-test `page.route` overrides `mockSicoApi` (Playwright matches most-recent first).

type AgentFixture = {
  id: number;
  name: string;
  role: string;
  iconUri: string;
};

function makeAgent(id: number, name: string): AgentFixture {
  return { id, name, role: "Role", iconUri: "" };
}

async function mockAgentsRoute(
  page: Page,
  handler: (url: URL) => {
    status?: number;
    body: unknown;
  },
): Promise<void> {
  await page.route(
    "**/api/sico/agent/single_agent_instances*",
    async (route) => {
      const { status = 200, body } = handler(new URL(route.request().url()));
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    },
  );
}

const AGENTS: AgentFixture[] = [makeAgent(5, "Chloe"), makeAgent(6, "Daniel")];

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test("renders cards and clicking the first navigates to collaboration", async ({
  page,
}) => {
  await mockAgentsRoute(page, () => ({
    body: makeOkEnvelope({
      instances: AGENTS,
      total: AGENTS.length,
      hasNext: false,
    }),
  }));
  await page.goto("/digital-worker");

  const firstCard = page.getByRole("link", {
    name: "Open Chloe's collaboration",
  });
  await expect(firstCard).toBeVisible();

  await firstCard.click();
  await expect(page).toHaveURL(/\/digital-worker\/5\/collaboration$/);
});

test("first card is keyboard reachable: Tab → Enter navigates", async ({
  page,
}) => {
  await mockAgentsRoute(page, () => ({
    body: makeOkEnvelope({
      instances: AGENTS,
      total: AGENTS.length,
      hasNext: false,
    }),
  }));
  await page.goto("/digital-worker");

  const firstCard = page.getByRole("link", {
    name: "Open Chloe's collaboration",
  });
  await expect(firstCard).toBeVisible();

  await firstCard.focus();
  await expect(firstCard).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/digital-worker\/5\/collaboration$/);
});

test("every img inside the grid has an alt attribute (empty allowed for decorative)", async ({
  page,
}) => {
  await mockAgentsRoute(page, () => ({
    body: makeOkEnvelope({
      instances: AGENTS,
      total: AGENTS.length,
      hasNext: false,
    }),
  }));
  await page.goto("/digital-worker");

  await expect(
    page.getByRole("link", { name: "Open Chloe's collaboration" }),
  ).toBeVisible();

  const alts = await page
    .locator("main img")
    .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")));

  expect(alts.length).toBeGreaterThan(0);
  // Decorative imagery: alt attribute present, empty allowed.
  for (const alt of alts) {
    expect(alt).not.toBeNull();
  }
});

test("shows skeleton while the first page is in flight", async ({ page }) => {
  // Delay so Suspense fallback is observable.
  await page.route(
    "**/api/sico/agent/single_agent_instances*",
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          makeOkEnvelope({
            instances: AGENTS,
            total: AGENTS.length,
            hasNext: false,
          }),
        ),
      });
    },
  );

  await page.goto("/digital-worker");
  await expect(
    page.getByRole("status", { name: "Loading digital workers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Chloe's collaboration" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("renders empty state when no digital workers exist", async ({ page }) => {
  await mockAgentsRoute(page, () => ({
    body: makeOkEnvelope({ instances: [], total: 0, hasNext: false }),
  }));

  await page.goto("/digital-worker");
  await expect(
    page.getByRole("heading", { level: 2, name: "No digital workers yet" }),
  ).toBeVisible();
});

test("renders error view with Try again button on 500", async ({ page }) => {
  await mockAgentsRoute(page, () => ({
    status: 500,
    body: { code: 500, msg: "server error", data: {} },
  }));

  await page.goto("/digital-worker");
  // Query client retries 3× before throwing to ErrorBoundary; allow >5s default.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
});

test("infinite scroll loads more pages via sentinel", async ({ page }) => {
  await page.route(
    "**/api/sico/agent/single_agent_instances*",
    async (route) => {
      const url = new URL(route.request().url());
      const requestedPage = Number(url.searchParams.get("page") ?? "1");
      if (requestedPage === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            makeOkEnvelope({
              instances: Array.from({ length: 3 }, (_, i) =>
                makeAgent(i + 1, `Agent ${i + 1}`),
              ),
              total: 6,
              hasNext: true,
            }),
          ),
        });
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          makeOkEnvelope({
            instances: Array.from({ length: 3 }, (_, i) =>
              makeAgent(i + 4, `Agent ${i + 4}`),
            ),
            total: 6,
            hasNext: false,
          }),
        ),
      });
    },
  );

  await page.goto("/digital-worker");
  await expect(
    page.getByRole("link", { name: "Open Agent 1's collaboration" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open Agent 3's collaboration" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link", { name: "Open Agent 6's collaboration" }),
  ).toBeVisible();
});
