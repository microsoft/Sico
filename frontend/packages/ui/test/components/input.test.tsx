import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("renders with textbox role", (): void => {
    render(<Input placeholder="Name" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with data-slot=input", (): void => {
    render(<Input placeholder="Name" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("data-slot", "input");
  });

  it("renders password type as non-textbox role", (): void => {
    render(<Input type="password" defaultValue="secret" />);
    // Password inputs intentionally have no implicit role to prevent
    // screen readers from reading the value aloud — assert by display value.
    expect(screen.getByDisplayValue("secret")).toHaveAttribute(
      "type",
      "password",
    );
  });

  describe("disabled state", () => {
    it("sets the disabled DOM attribute", (): void => {
      // Behavioral check — Tailwind `disabled:*` variants are always present
      // in the className string, so asserting them tells us nothing about the
      // disabled prop. The DOM attribute is the real contract.
      render(<Input disabled placeholder="Disabled" />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("does not fire onChange while disabled", async (): Promise<void> => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Input disabled onChange={onChange} placeholder="Disabled" />);
      await user.type(screen.getByRole("textbox"), "x");
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("invalid state", () => {
    it("forwards aria-invalid to the DOM", (): void => {
      // Behavioral check — Tailwind `aria-invalid:*` variants are always in the
      // className string. What matters is whether `aria-invalid` reaches the DOM
      // so assistive tech announces the error.
      render(<Input aria-invalid="true" placeholder="Email" />);
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });

  describe("controlled value", () => {
    it("reflects the value prop", (): void => {
      render(<Input value="hello" onChange={() => {}} />);
      expect(screen.getByRole("textbox")).toHaveValue("hello");
    });

    it("fires onChange on each keystroke", async (): Promise<void> => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Input onChange={onChange} placeholder="Type" />);
      await user.type(screen.getByRole("textbox"), "abc");
      expect(onChange).toHaveBeenCalledTimes(3);
    });
  });

  it("forwards native attributes (name / id)", (): void => {
    render(<Input id="email" name="email" placeholder="Email" />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAttribute("name", "email");
  });

  it("merges custom className", (): void => {
    render(<Input className="mt-4" placeholder="Test" />);
    expect(screen.getByRole("textbox")).toHaveClass("mt-4");
  });
});
