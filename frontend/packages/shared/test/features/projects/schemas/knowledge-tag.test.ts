import { describe, expect, it } from "vitest";

import { knowledgeTagSchema } from "@/features/projects/schemas/knowledge-tag";

const knowledgeTag = {
  id: 1,
  projectId: 7,
  name: "Refund requests",
  description: "Use when a customer asks for a refund",
  creatorUsername: "alice",
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

describe("knowledgeTagSchema", () => {
  it("maps 'when to use' onto description (no whenToUse field)", () => {
    const parsed = knowledgeTagSchema.parse(knowledgeTag);
    expect(parsed.description).toBe("Use when a customer asks for a refund");
    expect(parsed).not.toHaveProperty("whenToUse");
  });

  it("rejects a name longer than 256 chars", () => {
    expect(() =>
      knowledgeTagSchema.parse({ ...knowledgeTag, name: "x".repeat(257) }),
    ).toThrow();
  });
});
