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
  RecommendationTaskIconSchema,
  recommendationTaskSchema,
  recommendationTasksSchema,
} from "../../../../src/features/chat/schemas/recommendation-task";

describe("RecommendationTaskIconSchema", () => {
  it("maps BUILD to wire code 2", () => {
    expect(RecommendationTaskIconSchema.enum.BUILD).toBe(2);
  });

  it("maps RESEARCH to wire code 5", () => {
    expect(RecommendationTaskIconSchema.enum.RESEARCH).toBe(5);
  });
});

describe("recommendationTaskSchema", () => {
  it("parses a well-formed task", () => {
    const parsed = recommendationTaskSchema.parse({
      message: "Automate regression",
      icon: 2,
    });
    expect(parsed).toEqual({ message: "Automate regression", icon: 2 });
  });

  it("accepts an unknown icon code rather than rejecting (lenient number)", () => {
    const parsed = recommendationTaskSchema.parse({ message: "x", icon: 99 });
    expect(parsed.icon).toBe(99);
  });

  it("rejects a non-string message", () => {
    const result = recommendationTaskSchema.safeParse({ message: 1, icon: 2 });
    expect(result.success).toBe(false);
  });
});

describe("recommendationTasksSchema", () => {
  it("parses the tasks envelope into an array", () => {
    const parsed = recommendationTasksSchema.parse({
      tasks: [{ message: "a", icon: 0 }],
    });
    expect(parsed.tasks).toHaveLength(1);
  });

  it("defaults nothing — a missing tasks key rejects", () => {
    expect(recommendationTasksSchema.safeParse({}).success).toBe(false);
  });
});
