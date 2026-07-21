import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../../../../src/features/projects/components/empty-state";

describe("EmptyState", () => {
  it("renders the empty illustration as decorative (alt='')", () => {
    render(<EmptyState />);
    const img = screen.getByTestId("message-state-illustration");
    expect(img).toHaveAttribute("alt", "");
  });

  it("renders heading and body copy verbatim", () => {
    render(<EmptyState />);
    screen.getByRole("heading", { name: "Nothing here yet" });
    screen.getByText("Projects hold your digital workers and their work.");
  });

  it("renders no create CTA", () => {
    render(<EmptyState />);
    expect(
      screen.queryByRole("button", { name: /create project/i }),
    ).not.toBeInTheDocument();
  });
});
