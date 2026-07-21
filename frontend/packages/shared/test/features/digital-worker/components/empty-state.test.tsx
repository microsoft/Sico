import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/features/digital-worker/components/empty-state";

describe("EmptyState", () => {
  it("renders the shared heading", async () => {
    render(<EmptyState />);
    await screen.findByText("Your crew is one hire away");
  });

  it("renders the empty illustration as decorative", async () => {
    render(<EmptyState />);
    const img = await screen.findByTestId("message-state-illustration");
    expect(img.getAttribute("src")).toContain("empty-people.svg");
    expect(img).toHaveAttribute("alt", "");
  });

  it("does not render a create affordance", () => {
    render(<EmptyState />);
    expect(
      screen.queryByRole("button", { name: /add digital worker/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /create project/i }),
    ).toBeNull();
  });
});
