import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Label } from "@/components/ui/label";

describe("Label", () => {
  it("renders label element", (): void => {
    render(<Label htmlFor="email">Email</Label>);
    // <label> doesn't have an implicit ARIA role; locate via text, assert tagName
    expect(screen.getByText("Email").tagName).toBe("LABEL");
  });

  it("renders with data-slot=label", (): void => {
    render(<Label>Email</Label>);
    expect(screen.getByText("Email")).toHaveAttribute("data-slot", "label");
  });

  it("forwards htmlFor to native for attribute", (): void => {
    render(<Label htmlFor="email">Email</Label>);
    expect(screen.getByText("Email")).toHaveAttribute("for", "email");
  });

  it("merges custom className", (): void => {
    render(<Label className="mt-4">Email</Label>);
    expect(screen.getByText("Email")).toHaveClass("mt-4");
  });
});
