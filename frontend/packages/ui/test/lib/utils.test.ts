import { describe, expect, it } from "vitest";

import { cn } from "../../src/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
  });

  it("handles conflicting tailwind classes", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("handles falsy values", () => {
    expect(cn("flex", undefined, null, "gap-2")).toBe("flex gap-2");
  });
});
