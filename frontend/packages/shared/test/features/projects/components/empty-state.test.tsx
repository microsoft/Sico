import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("renders no CTA without an onCreate handler", () => {
    render(<EmptyState />);
    expect(
      screen.queryByRole("button", { name: /create project/i }),
    ).not.toBeInTheDocument();
  });

  it("fires onCreate when the Create project CTA is clicked", () => {
    const onCreate = vi.fn();
    render(<EmptyState onCreate={onCreate} />);
    screen.getByRole("button", { name: /create project/i }).click();
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
