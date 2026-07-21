import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssetContentCard } from "@/features/projects/components/asset-content-card";

describe("AssetContentCard", () => {
  it("renders its children", () => {
    render(
      <AssetContentCard>
        <p>card body</p>
      </AssetContentCard>,
    );
    expect(screen.getByText("card body")).toBeInTheDocument();
  });

  it("is the scrolling card surface (no inner gutter of its own)", () => {
    render(
      <AssetContentCard>
        <span data-testid="child" />
      </AssetContentCard>,
    );
    // The gutter is the caller's concern, so the child sits in a bare scroll
    // container — the card itself adds no padding.
    const scroll = screen.getByTestId("child").parentElement;
    expect(scroll).toHaveClass("overflow-y-auto");
    expect(scroll).not.toHaveClass("px-32");
  });
});
