import { describe, expect, it } from "vitest";

import { loginSearchSchema } from "@/features/rbac-login/schemas/login-search";

describe("loginSearchSchema", () => {
  it("accepts an empty search (direct visit)", () => {
    expect(loginSearchSchema.parse({})).toEqual({});
  });

  it("carries mode, code, and next through", () => {
    const parsed = loginSearchSchema.parse({
      mode: "developer",
      code: 401,
      next: "/studio",
    });
    expect(parsed).toEqual({ mode: "developer", code: 401, next: "/studio" });
  });

  it("accepts next at the 2048-char cap", () => {
    const atCap = `/${"a".repeat(2047)}`;
    expect(atCap.length).toBe(2048);
    expect(loginSearchSchema.parse({ next: atCap }).next).toBe(atCap);
  });

  it("rejects next longer than 2048 chars", () => {
    const oversized = `/${"a".repeat(2048)}`;
    expect(loginSearchSchema.safeParse({ next: oversized }).success).toBe(
      false,
    );
  });

  it("rejects a non-401 code", () => {
    expect(loginSearchSchema.safeParse({ code: 500 }).success).toBe(false);
  });
});
