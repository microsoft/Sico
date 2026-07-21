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
