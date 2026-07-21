import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserCard } from "@/features/chat/components/cards/user-card";

describe("UserCard", () => {
  it("renders the user's text", () => {
    render(<UserCard text="run the full performance suite" />);
    expect(
      screen.getByText("run the full performance suite"),
    ).toBeInTheDocument();
  });

  it("styles the bubble with the lavender user-input surface + primary text", () => {
    render(<UserCard text="hi" />);
    expect(screen.getByText("hi")).toHaveClass(
      "bg-surface-user-input",
      "text-foreground-primary",
    );
  });

  it("right-aligns a content-hugging bubble (ml-auto + w-fit)", () => {
    render(<UserCard text="hi" />);
    expect(screen.getByText("hi")).toHaveClass("ml-auto", "w-fit");
  });

  it("preserves the multi-line input's line breaks", () => {
    render(<UserCard text={"line one\nline two"} />);
    // whitespace-pre-wrap keeps the typed newline (the legacy plain div collapsed it).
    expect(screen.getByText(/line one/)).toHaveClass("whitespace-pre-wrap");
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(<UserCard text="hi" />);
    const bubble = container.firstElementChild;
    expect(bubble?.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(bubble?.getAttribute("style") ?? "").not.toMatch(
      /#[0-9a-fA-F]{3,8}/,
    );
  });
});
