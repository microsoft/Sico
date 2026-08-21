import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import {
  type RbacUser,
  rbacUserSchema,
  type RoleCode,
  type UserRole,
  userRoleSchema,
} from "../schemas/user-role";

// --- fetchUserRoles: GET /rbac/user_roles?userId ---------------------------

const rolesEnvelope = apiResponseSchema(
  z.object({
    // Coerce a null/missing role list to `[]` (backend sends `null` for a user
    // with no roles in scope) rather than rejecting the response.
    roles: z
      .array(userRoleSchema)
      .nullish()
      .transform((roles) => roles ?? []),
    // Pagination fields are display-only here; tolerate omissions so a
    // contract wobble can't reject the whole roles response.
    total: z.number().int().nonnegative().catch(0),
    hasNext: z.boolean().catch(false),
  }),
);

export async function fetchUserRoles(
  client: AxiosInstance,
  userId: number,
): Promise<UserRole[]> {
  const res = await client.get<unknown>("/rbac/user_roles", {
    params: { userId, page: 1, pageSize: 100 },
  });
  return unwrapData(rolesEnvelope.parse(res.data), "fetchUserRoles").roles;
}

// --- findUserByEmail: GET /rbac/users?email --------------------------------

const usersEnvelope = apiResponseSchema(
  z.object({
    // The backend returns `users: null` (not `[]`) for a role with zero users,
    // so coerce a missing/null list to an empty array rather than rejecting the
    // whole response.
    users: z
      .array(rbacUserSchema)
      .nullish()
      .transform((users) => users ?? []),
    total: z.number().int().nonnegative().catch(0),
    hasNext: z.boolean().catch(false),
  }),
);

export async function findUserByEmail(
  client: AxiosInstance,
  email: string,
): Promise<RbacUser | null> {
  const res = await client.get<unknown>("/rbac/users", {
    params: { email, page: 1, pageSize: 10 },
  });
  const { users } = unwrapData(
    usersEnvelope.parse(res.data),
    "findUserByEmail",
  );
  return users[0] ?? null;
}

// --- assign / remove: POST | DELETE /rbac/user_role ------------------------

export type UserRoleMutation = {
  userId: number;
  roleCode: RoleCode;
  scopeId: number;
  scopeType: string;
};

// A non-OK `code` inside an HTTP-200 envelope (e.g. permission denial) must
// reject — axios resolves the 200, so assert on the envelope code itself.
// The backend's `scopeId` is a STRING on the wire (it rejects a number:
// "cannot unmarshal number into ... scopeId of type string"), so serialize
// the numeric project id before sending. Callers keep passing a number.
export async function assignUserRole(
  client: AxiosInstance,
  { scopeId, ...body }: UserRoleMutation,
): Promise<void> {
  const res = await client.post<unknown>("/rbac/user_role", {
    ...body,
    scopeId: String(scopeId),
  });
  assertOk(apiResponseSchema(z.unknown()).parse(res.data), "assignUserRole");
}

// DELETE carries a request body — axios only sends it via the `data` option.
export async function removeUserRole(
  client: AxiosInstance,
  { scopeId, ...body }: UserRoleMutation,
): Promise<void> {
  const res = await client.delete<unknown>("/rbac/user_role", {
    data: { ...body, scopeId: String(scopeId) },
  });
  assertOk(apiResponseSchema(z.unknown()).parse(res.data), "removeUserRole");
}

// --- listUsersByRole: GET /rbac/role_users ---------------------------------

export type ListUsersByRoleParams = {
  roleCode: RoleCode;
  scopeType: string;
  scopeId: number;
};

export async function listUsersByRole(
  client: AxiosInstance,
  { roleCode, scopeType, scopeId }: ListUsersByRoleParams,
): Promise<RbacUser[]> {
  const res = await client.get<unknown>("/rbac/role_users", {
    // `scopeId` is a string on the wire (see assignUserRole); send it as one.
    params: {
      roleCode,
      scopeType,
      scopeId: String(scopeId),
      page: 1,
      pageSize: 100,
    },
  });
  return unwrapData(usersEnvelope.parse(res.data), "listUsersByRole").users;
}
