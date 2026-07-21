import { describe, expect, it } from "vitest";

import { authCodeSchema } from "@/features/rbac-login/schemas/auth-code";

describe("authCodeSchema", () => {
  it("accepts the literal 401", () => {
    expect(authCodeSchema.safeParse(401).success).toBe(true);
  });

  it("rejects unrelated HTTP codes such as 500", () => {
    expect(authCodeSchema.safeParse(500).success).toBe(false);
  });
});
