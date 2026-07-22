/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
