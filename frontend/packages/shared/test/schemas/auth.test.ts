import { describe, expect, it } from "vitest";

import { loginResponseSchema, userSchema } from "@/schemas/auth";

describe("userSchema", () => {
  it("accepts numeric int64 id from backend", () => {
    const result = userSchema.safeParse({
      id: 42,
      email: "a@b.co",
      roles: [
        { id: 7, roleCode: "project_admin", scopeType: "project", scopeId: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("parses scoped role-grant objects (backend common.UserRoleInfo)", () => {
    const result = userSchema.safeParse({
      id: 1,
      email: "a@b.co",
      roles: [
        {
          id: 24,
          roleCode: "project_member",
          scopeType: "project",
          scopeId: 76,
        },
        {
          id: 25,
          roleCode: "project_admin",
          scopeType: "project",
          scopeId: 80,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.roles).toHaveLength(2);
      expect(result.data.roles[0]).toEqual({
        id: 24,
        roleCode: "project_member",
        scopeType: "project",
        scopeId: 76,
      });
    }
  });

  it("rejects string id (legacy frontend shape)", () => {
    const result = userSchema.safeParse({
      id: "42",
      email: "a@b.co",
      roles: [],
    });
    expect(result.success).toBe(false);
  });

  // Regression — dogfood QA Round 1 FIND-1 (qa.md §W2).
  // Backend (`microsoft/sico`) serialises an unassigned roles slice as
  // JSON `null` for the `operator@sico.local` seed account. The schema
  // must accept `null` and coerce it to `[]` so downstream consumers can
  // call array methods without null checks.
  it("accepts null roles from backend and coerces to []", () => {
    const result = userSchema.safeParse({
      id: 1,
      alias: "Operator",
      username: "operator@sico.local",
      email: "operator@sico.local",
      tenant: "PUBLIC",
      phone: "",
      iconUri: undefined,
      rawIconUri: "",
      status: 1,
      description: "",
      roles: null,
      createdAt: 1779345578,
      updatedAt: 1779345578,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.roles).toEqual([]);
    }
  });
  // DWP's backend omits the `roles` field entirely (not even `null`), so the
  // login response arrives with `roles: undefined`. The schema must accept the
  // missing field and coerce to `[]` — otherwise the whole user fails to parse
  // and login silently drops the session (dwp test env, v-xingkezhu account).
  it("accepts a missing roles field and coerces to []", () => {
    const result = userSchema.safeParse({
      id: 6,
      alias: "v-xingkezhu",
      username: "v-xingkezhu@microsoft.com",
      email: "v-xingkezhu@microsoft.com",
      tenant: "PUBLIC",
      phone: "",
      iconUri: "",
      rawIconUri: "",
      status: 1,
      description: "",
      createdAt: 1762759355,
      updatedAt: 1762759355,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.roles).toEqual([]);
    }
  });
  it("normalises empty-string iconUri to undefined", () => {
    const result = userSchema.safeParse({
      id: 1,
      email: "a@b.co",
      iconUri: "",
      roles: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.iconUri).toBeUndefined();
    }
  });

  it("accepts valid https iconUri", () => {
    const result = userSchema.safeParse({
      id: 1,
      email: "a@b.co",
      iconUri: "https://example.com/a.png",
      roles: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("loginResponseSchema", () => {
  it("accepts epoch-seconds expiresAt (10-digit)", () => {
    const result = loginResponseSchema.safeParse({
      tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
      user: { id: 1, email: "a@b.co", roles: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects epoch-milliseconds expiresAt (13-digit)", () => {
    const result = loginResponseSchema.safeParse({
      tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000_000 },
      user: { id: 1, email: "a@b.co", roles: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative or zero expiresAt", () => {
    expect(
      loginResponseSchema.safeParse({
        tokenInfo: { accessToken: "tok", expiresAt: 0 },
        user: { id: 1, email: "a@b.co", roles: [] },
      }).success,
    ).toBe(false);
  });
});
