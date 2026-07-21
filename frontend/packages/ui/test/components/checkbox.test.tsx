import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Checkbox } from "../../src/components/ui/checkbox";

describe("Checkbox", () => {
  it("renders with checkbox role", (): void => {
    render(<Checkbox />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("renders with data-slot attribute", (): void => {
    render(<Checkbox />);
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "data-slot",
      "checkbox",
    );
  });

  describe("state classes", () => {
    it("carries the rest border utility", (): void => {
      render(<Checkbox />);
      expect(screen.getByRole("checkbox")).toHaveClass(
        "border-input-stroke-rest",
      );
    });

    it("checked fill via data-checked: utilities", (): void => {
      render(<Checkbox defaultChecked />);
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toHaveClass("data-checked:bg-button-primary-fill-rest");
      expect(checkbox).toHaveClass(
        "data-checked:border-button-primary-fill-rest",
      );
      expect(checkbox).toHaveClass("data-checked:text-foreground-on-inverted");
    });

    it("disabled → disabled:opacity-50 utility", (): void => {
      render(<Checkbox disabled />);
      expect(screen.getByRole("checkbox")).toHaveClass("disabled:opacity-50");
    });

    it("aria-invalid → aria-invalid:border-input-stroke-error utility", (): void => {
      render(<Checkbox aria-invalid />);
      expect(screen.getByRole("checkbox")).toHaveClass(
        "aria-invalid:border-input-stroke-error",
      );
    });
  });
});
