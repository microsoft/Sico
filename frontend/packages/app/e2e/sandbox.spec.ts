import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// E2E for the sandbox (Device) previewer: open it from the collaboration
// Header's Device button, then drive the four states its `/sandbox/instance`
// poll resolves into — loading, success (device grid), error (retry), and
// empty. The Device button itself only renders when the agent detail carries a
// non-empty `sandboxes`, so every test seeds that first.

const AGENT_ID = 5;
const COLLAB_URL = `/digital-worker/${AGENT_ID}/collaboration`;

// A sandbox device row as the wire sends it (sandboxSchema): a live `status`
// keeps it past the query's status filter; `vncUrl` is an https stub (the
// previewer hard-gates the url to https) pointed at a dead host so the iframe
// never paints real content.
function device(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sandboxId: "sb-1",
    displayName: "Pixel 7",
    type: "emulator",
    status: "in_use",
    vncUrl: "https://vnc.invalid/view",
    ...overrides,
  };
}

// Agent detail must carry `sandboxes` (count only — the button gates on length)
// so the Device button renders at all.
async function mockAgentWithDevices(page: Page): Promise<void> {
  await page.route(
    /\/api\/sico\/agent\/single_agent_instance\?/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          makeOkEnvelope({
            instance: {
              id: AGENT_ID,
              name: "Chloe",
              role: "Role",
              iconUri: "",
              sandboxes: [{}],
            },
          }),
        ),
      });
    },
  );
}

// Stub the message history so the collaboration page mounts its composer rather
// than throwing the schema error to the ErrorBoundary.
async function mockHistory(page: Page): Promise<void> {
  await page.route(/\/conversation\/messages\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeOkEnvelope({ messages: [], hasMore: false })),
    });
  });
}

// Register a `/sandbox/instance` handler. `handler` returns the fulfill shape so
// each test picks its own status/body (or hangs by never resolving).
async function mockSandbox(
  page: Page,
  handler: (route: import("@playwright/test").Route) => Promise<void> | void,
): Promise<void> {
  await page.route(/\/api\/sico\/sandbox\/instance\?/, handler);
}

// Open the collaboration page and click the Device button to mount the sandbox
// previewer. The button is icon-only — found by its `aria-label`.
async function openSandbox(page: Page): Promise<void> {
  await mockAgentWithDevices(page);
  await mockHistory(page);
  await page.goto(COLLAB_URL);
  await page.getByRole("button", { name: "Device" }).click();
}

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test.describe("sandbox previewer states", () => {
  test("shows a spinner while the device list is loading", async ({ page }) => {
    // Hold `/sandbox/instance` open so the pending spinner stays mounted.
    await mockSandbox(page, () => new Promise(() => {}));
    await openSandbox(page);

    await expect(page.getByLabel("Loading devices")).toBeVisible();
  });

  test("renders the device grid on a successful list", async ({ page }) => {
    await mockSandbox(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          makeOkEnvelope({
            items: [
              device({ sandboxId: "a", displayName: "Pixel 7" }),
              device({ sandboxId: "b", displayName: "Galaxy S24" }),
            ],
          }),
        ),
      });
    });
    await openSandbox(page);

    // Two devices → the grid lists both by name.
    await expect(page.getByText("Pixel 7")).toBeVisible();
    await expect(page.getByText("Galaxy S24")).toBeVisible();
  });

  test("shows the error state with retry when the list fails", async ({
    page,
  }) => {
    await mockSandbox(page, async (route) => {
      await route.fulfill({ status: 500, body: "boom" });
    });
    await openSandbox(page);

    // react-query retries a failed query 3× (1s + 2s + 4s back-off) before it
    // surfaces `isError`, so the ErrorView only appears after ~7s — give the
    // assertion room past that retry chain.
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("shows the empty state when no live devices remain", async ({
    page,
  }) => {
    await mockSandbox(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeOkEnvelope({ items: [] })),
      });
    });
    await openSandbox(page);

    await expect(page.getByText("No devices available.")).toBeVisible();
  });
});
