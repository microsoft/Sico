/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";

describe("Field", () => {
  it("renders with role=group", (): void => {
    render(<Field>content</Field>);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("renders with data-slot=field", (): void => {
    render(<Field>content</Field>);
    expect(screen.getByRole("group")).toHaveAttribute("data-slot", "field");
  });

  describe("orientation", () => {
    it("defaults to vertical", (): void => {
      render(<Field>content</Field>);
      const field = screen.getByRole("group");
      expect(field).toHaveAttribute("data-orientation", "vertical");
      expect(field).toHaveClass("flex-col");
    });

    it("applies horizontal orientation", (): void => {
      render(<Field orientation="horizontal">content</Field>);
      const field = screen.getByRole("group");
      expect(field).toHaveAttribute("data-orientation", "horizontal");
      expect(field).toHaveClass("flex-row");
    });

    it("applies responsive orientation", (): void => {
      render(<Field orientation="responsive">content</Field>);
      const field = screen.getByRole("group");
      expect(field).toHaveAttribute("data-orientation", "responsive");
      expect(field).toHaveClass("flex-col", "@md/field-group:flex-row");
    });
  });

  describe("data-invalid propagation", () => {
    it("applies ancestor tint class so descendants inherit danger-700", (): void => {
      // The whole-field tint via `data-[invalid=true]:text-danger-700` is the
      // upstream-aligned a11y pattern — Label / Description / Error pick up
      // the error color from the ancestor without prop wiring.
      render(
        <Field data-invalid="true">
          <FieldError>oops</FieldError>
        </Field>,
      );
      expect(screen.getByRole("group")).toHaveClass(
        "data-[invalid=true]:text-danger-700",
      );
    });
  });

  it("merges custom className", (): void => {
    render(<Field className="mt-4">content</Field>);
    expect(screen.getByRole("group")).toHaveClass("mt-4");
  });
});

describe("FieldLabel", () => {
  it("renders with data-slot=field-label", (): void => {
    render(<FieldLabel htmlFor="email">Email</FieldLabel>);
    expect(screen.getByText("Email")).toHaveAttribute(
      "data-slot",
      "field-label",
    );
  });

  it("forwards htmlFor", (): void => {
    render(<FieldLabel htmlFor="email">Email</FieldLabel>);
    expect(screen.getByText("Email")).toHaveAttribute("for", "email");
  });
});

describe("FieldDescription", () => {
  it("renders as paragraph", (): void => {
    render(<FieldDescription>Help text</FieldDescription>);
    expect(screen.getByText("Help text").tagName).toBe("P");
  });

  it("renders with data-slot=field-description", (): void => {
    render(<FieldDescription>Help text</FieldDescription>);
    expect(screen.getByText("Help text")).toHaveAttribute(
      "data-slot",
      "field-description",
    );
  });
});

describe("FieldError", () => {
  it("applies SICO base classes", (): void => {
    render(<FieldError>Required</FieldError>);
    expect(screen.getByRole("alert")).toHaveClass(
      "text-danger-700",
      "text-sm",
      "font-normal",
    );
  });

  it("renders with role=alert when has content", (): void => {
    render(<FieldError>Required</FieldError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });

  it("renders with data-slot=field-error", (): void => {
    render(<FieldError>Required</FieldError>);
    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-slot",
      "field-error",
    );
  });

  it("returns null when neither children nor errors provided", (): void => {
    render(<FieldError />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns null when errors array is empty", (): void => {
    render(<FieldError errors={[]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders single error message from errors array", (): void => {
    render(<FieldError errors={[{ message: "Required" }]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });

  it("renders multiple errors as list", (): void => {
    render(
      <FieldError
        errors={[{ message: "Too short" }, { message: "Must contain digit" }]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(2);
  });

  it("deduplicates errors by message", (): void => {
    render(
      <FieldError
        errors={[{ message: "Required" }, { message: "Required" }]}
      />,
    );
    const alert = screen.getByRole("alert");
    // After dedup the single message renders directly (not as <ul>).
    expect(alert).toHaveTextContent("Required");
    expect(within(alert).queryByRole("list")).not.toBeInTheDocument();
  });

  it("prefers children over errors prop", (): void => {
    render(<FieldError errors={[{ message: "ignored" }]}>Explicit</FieldError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Explicit");
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();
  });
});

describe("FieldGroup", () => {
  it("renders with data-slot=field-group", (): void => {
    render(<FieldGroup>group content</FieldGroup>);
    expect(screen.getByText("group content")).toHaveAttribute(
      "data-slot",
      "field-group",
    );
  });
});

describe("FieldSet", () => {
  it("renders as fieldset element", (): void => {
    render(<FieldSet>content</FieldSet>);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("renders with data-slot=field-set", (): void => {
    render(<FieldSet>content</FieldSet>);
    expect(screen.getByRole("group")).toHaveAttribute("data-slot", "field-set");
  });
});

describe("FieldLegend", () => {
  it("renders as legend element with default variant classes", (): void => {
    render(
      <FieldSet>
        <FieldLegend>Profile</FieldLegend>
      </FieldSet>,
    );
    const legend = screen.getByText("Profile");
    expect(legend.tagName).toBe("LEGEND");
    expect(legend).toHaveAttribute("data-variant", "legend");
    expect(legend).toHaveClass("data-[variant=legend]:text-base");
  });

  it("applies label variant classes", (): void => {
    render(
      <FieldSet>
        <FieldLegend variant="label">Profile</FieldLegend>
      </FieldSet>,
    );
    const legend = screen.getByText("Profile");
    expect(legend).toHaveAttribute("data-variant", "label");
    expect(legend).toHaveClass("data-[variant=label]:text-sm");
  });
});

describe("Field composition", () => {
  it("links label to input via htmlFor/id", (): void => {
    render(
      <Field>
        <FieldLabel htmlFor="email-1">Email</FieldLabel>
        <input id="email-1" />
      </Field>,
    );
    expect(screen.getByText("Email")).toHaveAttribute("for", "email-1");
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "email-1");
  });
});
