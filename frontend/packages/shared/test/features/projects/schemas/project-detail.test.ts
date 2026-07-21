import { describe, expect, it } from "vitest";

import { projectDetailSchema } from "@/features/projects/schemas/project";

const detail = {
  id: 1,
  name: "Atlas",
  description: "d",
  iconUrl: "",
  memberType: 1,
  agentInstances: [],
  ownerUsername: "alice",
  creatorUsername: "alice",
  operatorAdmins: ["bob", "carol"],
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

describe("projectDetailSchema", () => {
  it("parses detail fields on top of the list shape", () => {
    const p = projectDetailSchema.parse(detail);
    expect(p.operatorAdmins).toEqual(["bob", "carol"]);
    expect(p.ownerUsername).toBe("alice");
  });
  it("defaults operatorAdmins to [] when absent", () => {
    const { operatorAdmins, ...rest } = detail;
    void operatorAdmins;
    expect(projectDetailSchema.parse(rest).operatorAdmins).toEqual([]);
  });
  it("coerces operatorAdmins: null to [] (Go empty slice → null; §6 dec 6)", () => {
    expect(
      projectDetailSchema.parse({ ...detail, operatorAdmins: null })
        .operatorAdmins,
    ).toEqual([]);
  });
  it("tolerates memberType: 0 (Go zero-value the detail endpoint marshals for an unset role; §8 A)", () => {
    const parsed = projectDetailSchema.parse({ ...detail, memberType: 0 });
    expect(parsed.memberType).toBe(0);
  });
});
