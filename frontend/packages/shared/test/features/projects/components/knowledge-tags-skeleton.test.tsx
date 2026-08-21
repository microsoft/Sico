import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KnowledgeTagsSkeleton } from "@/features/projects/components/knowledge-tags-skeleton";

describe("<KnowledgeTagsSkeleton>", () => {
  it("renders a content-shaped loading status for the knowledge tags page", () => {
    render(<KnowledgeTagsSkeleton />);

    expect(
      screen.getByRole("status", { name: /Loading knowledge tags/i }),
    ).toBeInTheDocument();
  });

  it("mirrors the 3-column knowledge tags table with real headers and 5 rows", () => {
    render(<KnowledgeTagsSkeleton />);

    // Real header labels (not anonymous bars) so the placeholder reads as the
    // same table.
    expect(screen.getByText("KNOWLEDGE TAG")).toBeInTheDocument();
    expect(screen.getByText("DESCRIPTION")).toBeInTheDocument();
    expect(screen.getByText("ACTIONS")).toBeInTheDocument();
    expect(screen.getAllByTestId("knowledge-tags-skeleton-row")).toHaveLength(
      5,
    );
  });
});
