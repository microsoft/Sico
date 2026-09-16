import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import {
  mockOrganizationDetail,
  mockOrganizationRoleUsers,
} from "./fixtures/organization";
import {
  mockBoundOrganizationAccess,
  mockSicoApi,
  seedAuth,
} from "./fixtures/seed-auth";

const organizationProject = {
  id: 21,
  name: "Automation Hub",
  description: "",
  iconUrl: "",
  memberType: 1,
  agentInstances: [],
  ownerUsername: "owner@example.com",
  creatorUsername: "owner@example.com",
  organizationId: 9,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

type DeviceFixture = {
  sandbox_id: string;
  display_name: string;
  type: "emulator" | "physical" | "wincua";
  status: string;
  allocatable: boolean;
  organization_id: number;
  project_id: number;
  instance_id: string;
  instance_name: string;
  vnc_url: string;
};

function device(
  sandboxId: string,
  type: DeviceFixture["type"],
  projectId: number,
): DeviceFixture {
  return {
    sandbox_id: sandboxId,
    display_name: sandboxId,
    type,
    status: projectId === 0 ? "available" : "assigned",
    allocatable: true,
    organization_id: 9,
    project_id: projectId,
    instance_id: "",
    instance_name: "",
    vnc_url: "",
  };
}

async function mockOrganizationData(page: Page): Promise<void> {
  await mockBoundOrganizationAccess(page, {
    organizationIds: [9],
    grants: [{ roleCode: "org_admin", scopeId: 9 }],
  });
  await mockOrganizationDetail(page, {
    id: 9,
    name: "Orbit Operations",
    description: "",
    createdAt: 1,
    updatedAt: 1,
  });
  await mockOrganizationRoleUsers(page, {
    expectedScopeId: 9,
    usersByRole: {
      org_member: [
        { id: 2, email: "member@example.com", alias: "Morgan Member" },
      ],
    },
  });
  await page.route(/\/api\/sico\/project\/list\?/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("organizationId")).toBe("9");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("50");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeOkEnvelope({
          projects: [organizationProject],
          total: 1,
          hasNext: false,
        }),
      ),
    });
  });
  await page.route(/\/api\/sico\/sandbox\/list\?/, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("organizationId")).toBe("9");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeOkEnvelope({
          linux_workstation: [],
          emulator: [
            device("mobile-assigned", "emulator", 21),
            device("mobile-available", "emulator", 0),
          ],
          physical: [device("windows-available", "physical", 0)],
          wincua: [device("windows-assigned", "wincua", 21)],
        }),
      ),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
  await mockOrganizationData(page);
});

test(
  "direct organization projects access renders project and device data",
  { tag: ["@key", "@organization"] },
  async ({ page }) => {
    await page.goto("/organization/projects");

    await expect(page).toHaveURL(/\/organization\/projects$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();

    const projectsStat = page.getByRole("region", { name: "Projects" });
    await expect(projectsStat).toContainText("1 total");
    const mobileStat = page.getByRole("region", { name: "Mobiles" });
    await expect(mobileStat).toContainText("1 Available");
    await expect(mobileStat).toContainText("2 total");
    const windowsStat = page.getByRole("region", { name: "Windows" });
    await expect(windowsStat).toContainText("1 Available");
    await expect(windowsStat).toContainText("2 total");

    const projectRow = page.getByRole("row", { name: /Automation Hub/ });
    await expect(projectRow).toContainText("owner@example.com");
    await expect(projectRow).toContainText("Mobile 1");
    await expect(projectRow).toContainText("Windows 1");

    const navigation = page.getByRole("navigation", {
      name: "Organization management",
    });
    await expect(
      navigation.getByRole("link", { name: "Projects" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      navigation.getByRole("link", { name: "Organization" }),
    ).not.toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { level: 2, name: "Members" }),
    ).toHaveCount(0);
  },
);

test(
  "organization shell navigates between members and projects",
  { tag: ["@key", "@organization"] },
  async ({ page }) => {
    await page.goto("/organization/members");

    const shellTitle = page.getByText("Manage Organization", { exact: true });
    await expect(shellTitle).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Orbit Operations" }),
    ).toBeVisible();
    await expect(
      page.getByText("Morgan Member", { exact: true }),
    ).toBeVisible();

    const navigation = page.getByRole("navigation", {
      name: "Organization management",
    });
    await navigation.getByRole("link", { name: "Projects" }).click();

    await expect(page).toHaveURL(/\/organization\/projects$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Automation Hub/ }),
    ).toBeVisible();
    await expect(shellTitle).toBeVisible();

    await navigation.getByRole("link", { name: "Organization" }).click();

    await expect(page).toHaveURL(/\/organization\/members$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Orbit Operations" }),
    ).toBeVisible();
    await expect(
      page.getByText("Morgan Member", { exact: true }),
    ).toBeVisible();
    await expect(shellTitle).toBeVisible();
  },
);
