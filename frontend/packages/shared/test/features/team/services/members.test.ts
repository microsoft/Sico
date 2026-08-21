import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { fetchProjectMembers } from "../../../../src/features/team/services/members";
import { makeOkEnvelope } from "../../../../src/schemas/api";

// Each GET (one per role) resolves the next queued envelope in call order:
// call 1 → project_admin users, call 2 → project_member users.
function makeClient(responses: unknown[]): {
  client: AxiosInstance;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  for (const response of responses) {
    get.mockResolvedValueOnce({ data: response });
  }
  const client = { get } as Partial<AxiosInstance> as AxiosInstance;
  return { client, get };
}

const usersPayload = (
  users: { id: number; email: string; alias?: string }[],
): unknown => makeOkEnvelope({ users, total: users.length, hasNext: false });

describe("fetchProjectMembers", () => {
  it("queries role_users for both roles scoped to the project", async () => {
    const { client, get } = makeClient([usersPayload([]), usersPayload([])]);
    await fetchProjectMembers(client, 7);
    expect(get).toHaveBeenNthCalledWith(1, "/rbac/role_users", {
      params: {
        roleCode: "project_admin",
        scopeType: "project",
        scopeId: "7",
        page: 1,
        pageSize: 100,
      },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/rbac/role_users", {
      params: {
        roleCode: "project_member",
        scopeType: "project",
        scopeId: "7",
        page: 1,
        pageSize: 100,
      },
    });
  });

  it("tags each user with its role code", async () => {
    const { client } = makeClient([
      usersPayload([{ id: 1, email: "a@b.com" }]),
      usersPayload([{ id: 2, email: "c@d.com" }]),
    ]);
    const members = await fetchProjectMembers(client, 7);
    expect(members).toEqual([
      { id: 1, email: "a@b.com", roleCode: "project_admin" },
      { id: 2, email: "c@d.com", roleCode: "project_member" },
    ]);
  });

  it("dedupes a user in both roles as admin", async () => {
    const { client } = makeClient([
      usersPayload([{ id: 1, email: "a@b.com" }]),
      usersPayload([{ id: 1, email: "a@b.com" }]),
    ]);
    const members = await fetchProjectMembers(client, 7);
    expect(members).toHaveLength(1);
    expect(members[0]?.roleCode).toBe("project_admin");
  });

  it("returns an empty list when the project has no members", async () => {
    const { client } = makeClient([usersPayload([]), usersPayload([])]);
    expect(await fetchProjectMembers(client, 7)).toEqual([]);
  });

  it("rejects a non-OK envelope", async () => {
    const { client } = makeClient([{ code: 500, msg: "boom" }]);
    await expect(fetchProjectMembers(client, 7)).rejects.toThrow();
  });
});
