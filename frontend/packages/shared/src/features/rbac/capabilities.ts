import type { AxiosInstance } from "axios";

import { type RoleCode, type UserRole } from "./schemas/user-role";
import { fetchUserRoles } from "./services/user-role";

// The project role a user holds — the two project-scoped `RoleCode`s, or `null`
// for no project role (or a still-unknown role). Derived from `RoleCode` so a
// new project role in the zod enum flows here rather than drifting.
export type ProjectRole = RoleCode;

// Per-capability booleans the UI gates on — one flag per distinct action group
// from the RBAC design's permission keys. Consumers gate on a specific
// capability (plus a per-row `.own` email check where noted) instead of a
// blanket `isAdmin`, so a member keeps the actions they're actually entitled to.
export type ProjectCapabilities = {
  /** project.manage — edit/delete project, change member role, invite/remove
   * Operators + Admins, configure sandbox. Admin only. */
  canManageProject: boolean;
  /** dw.manage — reassign / dismiss ANY digital worker. Admin only. */
  canManageDw: boolean;
  /** dw.manage.own — invite a digital worker (member gets their own). */
  canInviteDw: boolean;
  /** asset.manage — delete ANY asset. Admin only. */
  canManageAsset: boolean;
  /** asset.manage.own — create an asset, delete OWN. Admin + member. */
  canManageAssetOwn: boolean;
  /** dw.use — run a DW + view results. Admin + member. */
  canUseDw: boolean;
};

const NONE: ProjectCapabilities = {
  canManageProject: false,
  canManageDw: false,
  canInviteDw: false,
  canManageAsset: false,
  canManageAssetOwn: false,
  canUseDw: false,
};

/**
 * The single role → capability map (RBAC design's Role-Permission Mapping,
 * project scope only). This is the ONLY place role logic lives — if the backend
 * later returns a real permission list, replace this function's body and every
 * consumer stays unchanged.
 *
 * - `project_admin` → every capability (admin's `*` supersets the `.own` ones).
 * - `project_member` → invite own DW, manage own assets, use DWs.
 * - `null` (no project role) → nothing.
 */
export function deriveCapabilities(
  role: ProjectRole | null,
): ProjectCapabilities {
  if (role === "project_admin") {
    return {
      canManageProject: true,
      canManageDw: true,
      canInviteDw: true,
      canManageAsset: true,
      canManageAssetOwn: true,
      canUseDw: true,
    };
  }
  if (role === "project_member") {
    return {
      ...NONE,
      canInviteDw: true,
      canManageAssetOwn: true,
      canUseDw: true,
    };
  }
  return NONE;
}

// Pick the user's role for THIS project from the full role list. Admin wins if
// both roles are somehow present. Non-project scopes (platform/org) are ignored.
// Shared by both permission hooks so the tie-break lives in one place.
export function projectRoleFor(
  roles: UserRole[],
  projectId: number,
): ProjectRole | null {
  const scoped = roles.filter(
    (r) => r.scopeType === "project" && r.scopeId === projectId,
  );
  if (scoped.some((r) => r.roleCode === "project_admin")) {
    return "project_admin";
  }
  if (scoped.some((r) => r.roleCode === "project_member")) {
    return "project_member";
  }
  return null;
}

// The user-roles query key + fn, shared so the suspense and non-suspense hooks
// hit ONE cache entry. Keyed on the user id (the roles are user-scoped, not
// project-scoped — a single fetch answers every project's role). A `null` id
// (user atom not hydrated) keys separately and resolves to no roles rather than
// fetching a phantom "user 0".
export function userRolesQueryOptions(
  apiClient: AxiosInstance,
  userId: number | null,
): {
  queryKey: readonly ["rbac", "user-roles", number | null];
  queryFn: () => Promise<UserRole[]>;
} {
  return {
    queryKey: ["rbac", "user-roles", userId] as const,
    queryFn: (): Promise<UserRole[]> =>
      userId === null ? Promise.resolve([]) : fetchUserRoles(apiClient, userId),
  };
}
