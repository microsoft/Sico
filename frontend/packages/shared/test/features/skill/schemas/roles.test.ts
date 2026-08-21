import { describe, expect, it } from "vitest";

import { rolesPayloadSchema } from "@/features/skill/schemas/roles";

describe("roles schema", () => {
  it("normalises the `{ role: string[] }` envelope payload to a Role[]", () => {
    const roles = rolesPayloadSchema.parse({
      role: ["Tester", "Developer"],
    });
    expect(roles).toHaveLength(2);
    expect(roles[0]).toEqual({ name: "Tester", value: "Tester" });
  });
});
