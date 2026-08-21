import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectsGridSkeleton } from "../../../../src/features/projects/components/projects-grid-skeleton";

describe("ProjectsGridSkeleton", () => {
  it("renders 12 aria-hidden card placeholders inside an aria-live status grid", () => {
    render(<ProjectsGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "Loading projects");
    const articles = screen.getAllByTestId("project-card-skeleton");
    expect(articles).toHaveLength(12);
    for (const article of articles) {
      expect(article).toHaveAttribute("aria-hidden", "true");
    }
  });
});
