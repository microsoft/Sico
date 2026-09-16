import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import {
  makeAgent,
  mockAgentDetail,
  mockHistory,
} from "./fixtures/agent-fixtures";
import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

const TARGET = "/digital-worker/904/collaboration/1942";
const MEMBERSHIP = "**/api/sico/organization/user_organizations*";
const HISTORY_TEXT = "History loaded with organization context";

function gate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function membershipBody(): string {
  return JSON.stringify(
    makeOkEnvelope({
      organizations: [
        {
          id: 9,
          name: "Bootstrap organization",
          description: "",
          createdAt: 1,
          updatedAt: 1,
          creatorUsername: "owner@example.test",
          roleCodes: [],
          isOwner: false,
        },
      ],
      total: 1,
      hasNext: false,
    }),
  );
}

function observeBusinessRequests(page: Page): {
  requests: { path: string; organizationId: string | undefined }[];
  first: Promise<void>;
} {
  const requests: { path: string; organizationId: string | undefined }[] = [];
  const first = gate();
  const paths = new Set([
    "/api/sico/agent/single_agent_instance",
    "/api/sico/conversation/list",
    "/api/sico/conversation/messages",
    "/api/sico/conversation/chat/reconnect",
  ]);
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (paths.has(path)) {
      requests.push({
        path,
        organizationId: request.headers()["x-sico-organization-id"],
      });
      first.release();
    }
  });
  return { requests, first: first.promise };
}

async function mockConversation(page: Page): Promise<void> {
  await mockAgentDetail(page, () => ({
    body: makeOkEnvelope({ instance: makeAgent(904, "Refresh tester") }),
  }));
  await mockHistory(page, [
    {
      messageId: 1,
      turnId: 7,
      role: "assistant",
      type: 1,
      content: HISTORY_TEXT,
    },
  ]);
  await page.route("**/api/sico/conversation/list?*", async (route) => {
    await route.fulfill({
      json: makeOkEnvelope({
        conversations: [{ id: 1942, title: "Refresh coverage" }],
        hasMore: false,
      }),
    });
  });
  await page.route(/\/api\/sico\/conversation\?/, async (route) => {
    await route.fulfill({
      json: makeOkEnvelope({
        conversation: { id: 1942, title: "Refresh coverage" },
      }),
    });
  });
  await page.route("**/api/sico/conversation/chat/reconnect", async (route) => {
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'event: done\ndata: {"timestamp":1}\n\n',
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSicoApi(page);
});

test("cold entry waits for organization and hard reload restores its local cache", async ({
  page,
}) => {
  await seedAuth(page);
  await mockConversation(page);
  const pending = gate();
  const membershipRequested = gate();
  const business = observeBusinessRequests(page);
  let membershipRequests = 0;
  await page.route(MEMBERSHIP, async (route) => {
    membershipRequests += 1;
    membershipRequested.release();
    await pending.promise;
    await route.fulfill({
      contentType: "application/json",
      body: membershipBody(),
    });
  });

  const navigation = page.goto(TARGET);
  try {
    expect(
      await Promise.race([
        membershipRequested.promise.then(() => "membership"),
        business.first.then(() => "business"),
      ]),
    ).toBe("membership");
    await expect(page.getByRole("status", { name: /Loading/ })).toBeVisible();
    expect(business.requests).toEqual([]);
    pending.release();
    await navigation;
    await expect(page.getByText(HISTORY_TEXT)).toBeVisible();
    await expect(page.getByLabel("Message input")).toBeVisible();
    expect(business.requests.length).toBeGreaterThan(0);
    expect(
      business.requests.every(({ organizationId }) => organizationId === "9"),
    ).toBe(true);
    expect(membershipRequests).toBe(1);

    business.requests.length = 0;
    await page.reload();
    await expect(page.getByText(HISTORY_TEXT)).toBeVisible();
    await expect(page.getByLabel("Message input")).toBeVisible();
    expect(business.requests.length).toBeGreaterThan(0);
    expect(
      business.requests.every(({ organizationId }) => organizationId === "9"),
    ).toBe(true);
    expect(membershipRequests).toBe(1);
  } finally {
    pending.release();
  }
});

test("organization failure blocks business requests and retry initializes the same route", async ({
  page,
}) => {
  await seedAuth(page);
  await mockConversation(page);
  const business = observeBusinessRequests(page);
  let failing = true;
  await page.route(MEMBERSHIP, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: failing
        ? JSON.stringify({ code: 100001, msg: "Organization lookup failed" })
        : membershipBody(),
    });
  });

  await page.goto(TARGET);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
  expect(business.requests).toEqual([]);

  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page).toHaveURL(new RegExp(`${TARGET}$`));
  await expect(page.getByText(HISTORY_TEXT)).toBeVisible();
  expect(
    business.requests.every(({ organizationId }) => organizationId === "9"),
  ).toBe(true);
});

test("public home, login, and registration do not initialize organizations", async ({
  page,
}) => {
  let membershipRequests = 0;
  await page.route(MEMBERSHIP, async (route) => {
    membershipRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: membershipBody(),
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/landing\/index\.html$/);
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  await page.goto("/register");
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  expect(membershipRequests).toBe(0);
});
