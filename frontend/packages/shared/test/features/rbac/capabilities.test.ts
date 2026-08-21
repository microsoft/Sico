import { describe, expect, it } from "vitest";

import {
  deriveCapabilities,
  type ProjectCapabilities,
  projectRoleFor,
} from "@/features/rbac/capabilities";
import { type UserRole } from "@/features/rbac/schemas/user-role";

const ALL_KEYS: (keyof ProjectCapabilities)[] = [
  "canManageProject",
  "canManageDw",
  "canInviteDw",
  "canManageAsset",
  "canManageAssetOwn",
  "canUseDw",
];

describe("deriveCapabilities", () => {
  it("grants every capability to a project_admin", () => {
    const caps = deriveCapabilities("project_admin");
    for (const key of ALL_KEYS) {
      expect(caps[key]).toBe(true);
    }
  });

  it("grants a project_member only invite-dw / own-asset / use-dw", () => {
    expect(deriveCapabilities("project_member")).toEqual({
      canManageProject: false,
      canManageDw: false,
      canInviteDw: true,
      canManageAsset: false,
      canManageAssetOwn: true,
      canUseDw: true,
    });
  });

  it("grants nothing for a null role", () => {
    const caps = deriveCapabilities(null);
    for (const key of ALL_KEYS) {
      expect(caps[key]).toBe(false);
    }
  });
});

function role(partial: Partial<UserRole>): UserRole {
  return {
    roleCode: "project_member",
    scopeType: "project",
    scopeId: 5,
    userId: 1,
    ...partial,
  };
}

describe("projectRoleFor", () => {
  it("returns the project_member role scoped to the project", () => {
    expect(projectRoleFor([role({ roleCode: "project_member" })], 5)).toBe(
      "project_member",
    );
  });

  it("lets admin win when both roles are present", () => {
    expect(
      projectRoleFor(
        [
          role({ roleCode: "project_member" }),
          role({ roleCode: "project_admin" }),
        ],
        5,
      ),
    ).toBe("project_admin");
  });

  it("ignores roles scoped to a different project", () => {
    expect(
      projectRoleFor([role({ roleCode: "project_admin", scopeId: 9 })], 5),
    ).toBeNull();
  });

  it("ignores non-project scopes (platform/org)", () => {
    expect(
      projectRoleFor(
        [role({ roleCode: "platform_admin", scopeType: "platform" })],
        5,
      ),
    ).toBeNull();
  });

  it("returns null for an empty role list", () => {
    expect(projectRoleFor([], 5)).toBeNull();
  });
});
