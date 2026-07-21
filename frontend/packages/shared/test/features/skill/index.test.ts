import { describe, expect, it } from "vitest";

import * as skill from "@/features/skill";

describe("skill barrel", () => {
  it("exposes the public surface", () => {
    expect(skill.SetupBasicInfo).toBeTypeOf("function");
    expect(skill.useSkillsQuery).toBeTypeOf("function");
    expect(skill.useRolesQuery).toBeTypeOf("function");
    expect(skill.SkillStatusSchema).toBeDefined();
  });
});
