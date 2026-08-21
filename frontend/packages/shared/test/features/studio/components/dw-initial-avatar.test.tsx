import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DwInitialAvatar } from "@/features/studio/components/dw-initial-avatar";

describe("DwInitialAvatar", () => {
  it("renders the uppercased first initial of the name", () => {
    render(<DwInitialAvatar name="atlas" />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("applies the J-R palette (initial 74-82)", () => {
    render(<DwInitialAvatar name="Nova" />);
    const el = screen.getByText("N");
    expect(el).toHaveStyle({
      background: "#F5F3FF",
      borderColor: "#BCB8FF",
      color: "#3B32B3",
    });
  });

  it("applies the A-I palette (initial 65-73, default fallback)", () => {
    render(<DwInitialAvatar name="Atlas" />);
    const el = screen.getByText("A");
    expect(el).toHaveStyle({
      background: "#F3F4F6",
      borderColor: "#C6D0DA",
      color: "#424A52",
    });
  });

  it("applies the S-Z palette (initial 83-90)", () => {
    render(<DwInitialAvatar name="Sol" />);
    const el = screen.getByText("S");
    expect(el).toHaveStyle({
      background: "#EBF5FF",
      borderColor: "#C6D0DA",
      color: "#004C8E",
    });
  });

  it("honours custom size and fontSize", () => {
    render(<DwInitialAvatar name="Sol" size={24} fontSize={12} />);
    const el = screen.getByText("S");
    expect(el).toHaveStyle({ width: "24px", height: "24px", fontSize: "12px" });
  });

  it("is hidden from the a11y tree when decorative", () => {
    render(<DwInitialAvatar name="Atlas" decorative />);
    expect(screen.getByText("A")).toHaveAttribute("aria-hidden", "true");
  });
});
