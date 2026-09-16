import { type Page } from "@playwright/test";
import { type OrganizationRoleCode } from "@sico/shared/features/rbac/index.ts";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
} from "@sico/shared/utils/local-storage.ts";

// Seed the auth triple via `addInitScript` so the SPA starts logged in.
// Route mode is derived from the URL; it is not persisted in localStorage.
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ tokenKey, userKey, expiresAtKey }) => {
      // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
      localStorage.setItem(tokenKey, "tok");
      // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
      localStorage.setItem(
        userKey,
        JSON.stringify({ id: 1, email: "a@b.test", roles: [] }),
      );
      // eslint-disable-next-line no-restricted-syntax -- e2e fixture runs in browser context, wrapper unavailable
      localStorage.setItem(
        expiresAtKey,
        String(Math.floor(Date.now() / 1000) + 3600),
      );
    },
    {
      tokenKey: AUTH_TOKEN_LS,
      userKey: AUTH_USER_LS,
      expiresAtKey: AUTH_EXPIRES_AT_LS,
    },
  );
}

type OrganizationGrant = {
  roleCode: OrganizationRoleCode;
  scopeId: number;
};

type BoundOrganizationAccess = {
  organizationIds?: number[];
  grants?: OrganizationGrant[];
  organizationStatus?: number;
  rolesStatus?: number;
};

export async function mockBoundOrganizationAccess(
  page: Page,
  {
    organizationIds = [9],
    grants,
    organizationStatus = 200,
    rolesStatus = 200,
  }: BoundOrganizationAccess = {},
): Promise<void> {
  const boundOrganizationId = organizationIds[0];
  const resolvedGrants =
    grants ??
    (boundOrganizationId === undefined
      ? []
      : [{ roleCode: "developer" as const, scopeId: boundOrganizationId }]);
  await page.route(
    "**/api/sico/organization/user_organizations*",
    async (route) => {
      const organizations = organizationIds.map((id, index) => ({
        id,
        name: `SICO ${String(index + 1)}`,
        description: "",
        createdAt: 1,
        updatedAt: 1,
        creatorUsername: "owner@example.com",
        roleCodes: ["org_member"],
        isOwner: false,
      }));
      await route.fulfill({
        status: organizationStatus,
        contentType: "application/json",
        body: JSON.stringify(
          organizationStatus >= 400
            ? { code: organizationStatus, msg: "organization error", data: {} }
            : makeOkEnvelope({
                organizations,
                total: organizations.length,
                hasNext: false,
              }),
        ),
      });
    },
  );
  await page.route("**/api/sico/rbac/user_roles*", async (route) => {
    const roles = resolvedGrants.map(({ roleCode, scopeId }) => ({
      userId: 1,
      roleCode,
      scopeType: "org",
      scopeId,
    }));
    await route.fulfill({
      status: rolesStatus,
      contentType: "application/json",
      body: JSON.stringify(
        rolesStatus >= 400
          ? { code: rolesStatus, msg: "roles error", data: {} }
          : makeOkEnvelope({ roles, total: roles.length, hasNext: false }),
      ),
    });
  });
}

// Defensive stub so an accidental fetch can't reach the real backend.
export async function mockSicoApi(page: Page): Promise<void> {
  await page.route("**/api/sico/**", async (route) => {
    const isMembership =
      new URL(route.request().url()).pathname ===
      "/api/sico/organization/user_organizations";
    const data = isMembership
      ? {
          organizations: [
            {
              id: 9,
              name: "SICO 1",
              description: "",
              createdAt: 1,
              updatedAt: 1,
              creatorUsername: "owner@example.com",
              roleCodes: [],
              isOwner: false,
            },
          ],
          total: 1,
          hasNext: false,
        }
      : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeOkEnvelope(data)),
    });
  });
}
