import { describe, expect, it } from "vitest";

import {
  skillDetailSchema,
  skillItemSchema,
  SkillStatusSchema,
} from "@/features/skill/schemas/skill";

describe("skill schemas", () => {
  it("parses a skill list item", () => {
    const item = skillItemSchema.parse({
      id: 7,
      agentId: "a1",
      name: "Visual Deconstructor",
      description: "desc",
      version: "v1",
      status: 2,
      assetId: 11,
      creatorUsername: "max@x.com",
      failReason: "",
      projectId: 3,
      createdAt: 1,
      updatedAt: "2",
    });
    expect(item.status).toBe(SkillStatusSchema.enum.UPLOADED);
    expect(item.name).toBe("Visual Deconstructor");
  });

  it("parses skill detail with versions, files and actions", () => {
    const detail = skillDetailSchema.parse({
      skill: {
        id: 7,
        agentId: "a1",
        name: "S",
        description: "d",
        version: "v2",
        projectId: 3,
        createdAt: 1,
        updatedAt: 2,
      },
      versions: [
        {
          id: 100,
          skillId: 7,
          version: "v2",
          name: "S",
          description: "d",
          assetId: 11,
          url: "https://x/s.zip",
          creatorUsername: "max",
          failReason: "",
          createdAt: 1,
          updatedAt: 2,
          files: [{ path: "skill.md", content: "# hi" }],
          actions: [
            { name: "vector search", description: "d", advancedSettings: "{}" },
          ],
        },
      ],
    });
    expect(detail.versions[0]?.files[0]?.path).toBe("skill.md");
    expect(detail.versions[0]?.actions[0]?.name).toBe("vector search");
  });

  it("rejects an out-of-range status", () => {
    expect(() =>
      skillItemSchema.parse({
        id: 1,
        agentId: "a",
        name: "n",
        description: "",
        version: "v",
        status: 99,
        assetId: 1,
        creatorUsername: "",
        failReason: "",
        projectId: 1,
        createdAt: 1,
        updatedAt: "2",
      }),
    ).toThrow();
  });
});
