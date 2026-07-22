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
