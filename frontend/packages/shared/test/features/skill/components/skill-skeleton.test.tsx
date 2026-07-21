import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SkillSkeleton } from "@/features/skill/components/skill-list/skill-skeleton";

describe("SkillSkeleton", () => {
  it("renders placeholder rows", () => {
    render(<SkillSkeleton />);
    expect(
      screen.getAllByTestId("skill-skeleton-row").length,
    ).toBeGreaterThanOrEqual(3);
  });
});
