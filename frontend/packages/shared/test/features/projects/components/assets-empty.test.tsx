import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssetsEmpty } from "@/features/projects/components/assets-empty";

describe("<AssetsEmpty>", () => {
  it("renders the interpolated search no-match body for the search variant", () => {
    render(<AssetsEmpty variant="search" query="invoices" />);

    expect(screen.getByRole("heading", { name: "No assets yet" }));
    expect(
      screen.getByText('No assets match "invoices". Try a different search.'),
    ).toBeInTheDocument();
  });

  it("renders the All category body and heading", () => {
    render(<AssetsEmpty variant="category" category="all" />);

    expect(
      screen.getByRole("heading", { name: "No assets yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Upload knowledge or wait for your digital workers to produce deliverables.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the Knowledge category body", () => {
    render(<AssetsEmpty variant="category" category="knowledge" />);

    expect(
      screen.getByText("Add knowledge to give this project shared context."),
    ).toBeInTheDocument();
  });

  it("renders the Deliverable category body", () => {
    render(<AssetsEmpty variant="category" category="deliverable" />);

    expect(
      screen.getByText(
        "Deliverables will appear here once your digital workers publish them.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the Experience category body", () => {
    render(<AssetsEmpty variant="category" category="experience" />);

    expect(
      screen.getByText(
        "Experiences will appear here as your digital workers learn from tasks.",
      ),
    ).toBeInTheDocument();
  });
});
