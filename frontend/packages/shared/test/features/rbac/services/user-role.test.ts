import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
  assignUserRole,
  fetchUserRoles,
  findUserByEmail,
  listUsersByRole,
  removeUserRole,
} from "../../../../src/features/rbac/services/user-role";
import { makeOkEnvelope } from "../../../../src/schemas/api";

function makeGetClient(response: unknown): {
  client: AxiosInstance;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn().mockResolvedValue({ data: response });
  const client = { get } as Partial<AxiosInstance> as AxiosInstance;
  return { client, get };
}

describe("fetchUserRoles", () => {
  it("GETs the roles for a user with paging params and returns the roles array", async () => {
    const roles = [
      {
        roleCode: "project_admin",
        scopeType: "project",
        scopeId: 5,
        userId: 42,
        user: { id: 42, email: "a@b.com", alias: "Ann" },
      },
    ];
    const { client, get } = makeGetClient(
      makeOkEnvelope({ roles, total: 1, hasNext: false }),
    );
    const result = await fetchUserRoles(client, 42);
    expect(get).toHaveBeenCalledWith("/rbac/user_roles", {
      params: { userId: 42, page: 1, pageSize: 100 },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.roleCode).toBe("project_admin");
  });

  it("returns an empty array when the user has no roles", async () => {
    const { client } = makeGetClient(
      makeOkEnvelope({ roles: [], total: 0, hasNext: false }),
    );
    const result = await fetchUserRoles(client, 42);
    expect(result).toEqual([]);
  });

  it("coerces a null roles list to an empty array", async () => {
    // Backend sends `roles: null` (not `[]`) for a user with no roles in scope.
    const { client } = makeGetClient(
      makeOkEnvelope({ roles: null, total: 0, hasNext: false }),
    );
    const result = await fetchUserRoles(client, 42);
    expect(result).toEqual([]);
  });

  it("tolerates non-project roleCodes and a null embedded user", async () => {
    // A real user_roles listing spans every scope: platform/org roles and an
    // empty placeholder grant with `user: null` sit alongside project ones.
    // The schema must accept them (roleCode is a bare string), or the whole
    // Person tab errors out. Regression from live dwp data.
    const roles = [
      { roleCode: "", scopeType: "", scopeId: 0, userId: 14, user: null },
      {
        roleCode: "platform_admin",
        scopeType: "platform",
        scopeId: 0,
        userId: 14,
      },
      { roleCode: "org_admin", scopeType: "org", scopeId: 4, userId: 14 },
      {
        roleCode: "project_admin",
        scopeType: "project",
        scopeId: 80,
        userId: 14,
      },
    ];
    const { client } = makeGetClient(
      makeOkEnvelope({ roles, total: 4, hasNext: false }),
    );
    const result = await fetchUserRoles(client, 14);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.roleCode)).toContain("platform_admin");
  });

  it("coerces a string scopeId from the wire into a number", async () => {
    // Live dwp sends `scopeId` as a STRING ("80"), but `projectRoleFor`
    // compares it against a numeric `projectId` with `===`. A plain
    // `z.number()` rejected the string and `.catch(0)` silently zeroed EVERY
    // grant — so `0 === 80` never matched and the user lost all project
    // permissions. `z.coerce.number()` must turn "80" into 80.
    const roles = [
      {
        roleCode: "project_admin",
        scopeType: "project",
        scopeId: "80",
        userId: 6,
      },
    ];
    const { client } = makeGetClient(
      makeOkEnvelope({ roles, total: 1, hasNext: false }),
    );
    const result = await fetchUserRoles(client, 6);
    expect(result[0]!.scopeId).toBe(80);
  });

  it("tolerates a grant that omits scopeId / scopeType", async () => {
    // A non-project grant that drops scopeId/scopeType must NOT reject the whole
    // list — the same resilience the bare-string roleCode provides. Missing
    // fields default to 0 / "".
    const roles = [
      { roleCode: "platform_admin", userId: 14 },
      {
        roleCode: "project_admin",
        scopeType: "project",
        scopeId: 80,
        userId: 14,
      },
    ];
    const { client } = makeGetClient(
      makeOkEnvelope({ roles, total: 2, hasNext: false }),
    );
    const result = await fetchUserRoles(client, 14);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ scopeId: 0, scopeType: "" });
  });
});

describe("findUserByEmail", () => {
  it("GETs users by email and returns the first match", async () => {
    const { client, get } = makeGetClient(
      makeOkEnvelope({
        users: [{ id: 7, email: "a@b.com", alias: "Ann", iconUri: "" }],
        total: 1,
        hasNext: false,
      }),
    );
    const result = await findUserByEmail(client, "a@b.com");
    expect(get).toHaveBeenCalledWith("/rbac/users", {
      params: { email: "a@b.com", page: 1, pageSize: 10 },
    });
    expect(result?.id).toBe(7);
  });

  it("returns null when no user matches", async () => {
    const { client } = makeGetClient(
      makeOkEnvelope({ users: [], total: 0, hasNext: false }),
    );
    const result = await findUserByEmail(client, "none@b.com");
    expect(result).toBeNull();
  });
});

describe("assignUserRole", () => {
  it("POSTs the role assignment body", async () => {
    const post = vi.fn().mockResolvedValue({ data: makeOkEnvelope({}) });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    await assignUserRole(client, {
      userId: 7,
      roleCode: "project_member",
      scopeId: 5,
      scopeType: "project",
    });
    expect(post).toHaveBeenCalledWith("/rbac/user_role", {
      userId: 7,
      roleCode: "project_member",
      scopeId: "5",
      scopeType: "project",
    });
  });

  it("rejects a non-OK envelope code", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    await expect(
      assignUserRole(client, {
        userId: 7,
        roleCode: "project_member",
        scopeId: 5,
        scopeType: "project",
      }),
    ).rejects.toThrow(/rejected \(code 101008\)/);
  });
});

describe("removeUserRole", () => {
  it("DELETEs the role with the body under the axios data option", async () => {
    const del = vi.fn().mockResolvedValue({ data: makeOkEnvelope({}) });
    const client = { delete: del } as Partial<AxiosInstance> as AxiosInstance;
    await removeUserRole(client, {
      userId: 7,
      roleCode: "project_admin",
      scopeId: 5,
      scopeType: "project",
    });
    expect(del).toHaveBeenCalledWith("/rbac/user_role", {
      data: {
        userId: 7,
        roleCode: "project_admin",
        scopeId: "5",
        scopeType: "project",
      },
    });
  });

  it("rejects a non-OK envelope code", async () => {
    const del = vi
      .fn()
      .mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    const client = { delete: del } as Partial<AxiosInstance> as AxiosInstance;
    await expect(
      removeUserRole(client, {
        userId: 7,
        roleCode: "project_admin",
        scopeId: 5,
        scopeType: "project",
      }),
    ).rejects.toThrow(/rejected \(code 101008\)/);
  });
});

describe("listUsersByRole", () => {
  it("GETs role_users with the role scope params and returns the users array", async () => {
    const { client, get } = makeGetClient(
      makeOkEnvelope({
        users: [{ id: 7, email: "a@b.com", alias: "Ann", iconUri: "" }],
        total: 1,
        hasNext: false,
      }),
    );
    const result = await listUsersByRole(client, {
      roleCode: "project_admin",
      scopeType: "project",
      scopeId: 5,
    });
    expect(get).toHaveBeenCalledWith("/rbac/role_users", {
      params: {
        roleCode: "project_admin",
        scopeType: "project",
        scopeId: "5",
        page: 1,
        pageSize: 100,
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe("a@b.com");
  });

  it("returns an empty array when no users hold the role", async () => {
    const { client } = makeGetClient(
      makeOkEnvelope({ users: [], total: 0, hasNext: false }),
    );
    const result = await listUsersByRole(client, {
      roleCode: "project_admin",
      scopeType: "project",
      scopeId: 5,
    });
    expect(result).toEqual([]);
  });

  it("coerces a null users list to an empty array", async () => {
    // The backend returns `users: null` (not `[]`) for a role with zero users;
    // the schema must tolerate it, or the whole Person tab errors out.
    // Regression from live dwp data.
    const { client } = makeGetClient(
      makeOkEnvelope({ users: null, total: 0, hasNext: false }),
    );
    const result = await listUsersByRole(client, {
      roleCode: "project_member",
      scopeType: "project",
      scopeId: 5,
    });
    expect(result).toEqual([]);
  });
});
