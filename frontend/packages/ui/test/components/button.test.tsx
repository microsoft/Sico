import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  describe("variants", () => {
    it("applies primary variant by default", (): void => {
      render(<Button>Primary</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-button-primary-fill-rest");
      expect(button).toHaveClass("text-button-primary-foreground-rest");
    });

    it("applies secondary variant classes", (): void => {
      render(<Button variant="secondary">Secondary</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-button-secondary-fill-rest");
      expect(button).toHaveClass("border-button-secondary-stroke-rest");
    });

    it("applies subtle variant classes", (): void => {
      render(<Button variant="subtle">Subtle</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-button-subtle-fill-rest");
    });

    it("applies destructive variant classes", (): void => {
      render(<Button variant="destructive">Delete</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-button-destructive-fill-rest");
      expect(button).toHaveClass("text-button-destructive-foreground-rest");
    });

    it("applies link variant classes", (): void => {
      render(<Button variant="link">View details</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("text-button-link-foreground-rest");
    });

    it("applies destructive-outline variant classes", (): void => {
      render(<Button variant="destructive-outline">Delete</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("bg-button-destructive-outline-fill-rest");
      expect(button).toHaveClass(
        "border-button-destructive-outline-stroke-rest",
      );
      expect(button).toHaveClass(
        "text-button-destructive-outline-foreground-rest",
      );
    });
  });

  describe("sizes", () => {
    it("applies default size (h-8)", (): void => {
      render(<Button>Default</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-8");
    });

    it("applies xs size (h-6)", (): void => {
      render(<Button size="xs">XS</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-6");
    });

    it("applies sm size (h-7)", (): void => {
      render(<Button size="sm">SM</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-7");
    });

    it("applies lg size (h-9)", (): void => {
      render(<Button size="lg">LG</Button>);
      expect(screen.getByRole("button")).toHaveClass("h-9");
    });

    it("applies icon size (size-8)", (): void => {
      render(<Button size="icon">I</Button>);
      expect(screen.getByRole("button")).toHaveClass("size-8");
    });

    it("applies icon-xs size (size-6)", (): void => {
      render(<Button size="icon-xs">I</Button>);
      expect(screen.getByRole("button")).toHaveClass("size-6");
    });

    it("applies icon-sm size (size-7)", (): void => {
      render(<Button size="icon-sm">I</Button>);
      expect(screen.getByRole("button")).toHaveClass("size-7");
    });

    it("applies icon-lg size (size-9)", (): void => {
      render(<Button size="icon-lg">I</Button>);
      expect(screen.getByRole("button")).toHaveClass("size-9");
    });
  });

  describe("state classes", () => {
    it("disabled → applies per-variant disabled classes on primary", (): void => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("disabled:bg-button-primary-fill-disabled");
      expect(button).toHaveClass(
        "disabled:text-button-primary-foreground-disabled",
      );
    });

    it("disabled → applies per-variant disabled classes on destructive", (): void => {
      render(
        <Button variant="destructive" disabled>
          Delete
        </Button>,
      );
      expect(screen.getByRole("button")).toHaveClass(
        "disabled:text-button-destructive-foreground-disabled",
      );
    });

    it("disabled → applies per-variant disabled classes on secondary", (): void => {
      render(
        <Button variant="secondary" disabled>
          Secondary
        </Button>,
      );
      const button = screen.getByRole("button");
      expect(button).toHaveClass("disabled:bg-button-secondary-fill-disabled");
      expect(button).toHaveClass(
        "disabled:border-button-secondary-stroke-disabled",
      );
      expect(button).toHaveClass(
        "disabled:text-button-secondary-foreground-disabled",
      );
    });

    it("disabled → applies per-variant disabled classes on subtle", (): void => {
      render(
        <Button variant="subtle" disabled>
          Subtle
        </Button>,
      );
      expect(screen.getByRole("button")).toHaveClass(
        "disabled:text-button-subtle-foreground-disabled",
      );
    });

    it("disabled → applies per-variant disabled classes on destructive-outline", (): void => {
      render(
        <Button variant="destructive-outline" disabled>
          Delete
        </Button>,
      );
      const button = screen.getByRole("button");
      expect(button).toHaveClass(
        "disabled:bg-button-destructive-outline-fill-disabled",
      );
      expect(button).toHaveClass(
        "disabled:border-button-destructive-outline-stroke-disabled",
      );
      expect(button).toHaveClass(
        "disabled:text-button-destructive-outline-foreground-disabled",
      );
    });

    it("disabled → applies per-variant disabled classes on link", (): void => {
      render(
        <Button variant="link" disabled>
          View details
        </Button>,
      );
      expect(screen.getByRole("button")).toHaveClass(
        "disabled:text-button-link-foreground-disabled",
      );
    });

    it("aria-invalid → applies error ring + border", (): void => {
      render(<Button aria-invalid>Invalid</Button>);
      const button = screen.getByRole("button");
      expect(button).toHaveClass("aria-invalid:border-destructive");
      expect(button).toHaveClass("aria-invalid:ring-destructive/20");
      expect(button).toHaveClass("aria-invalid:ring-3");
    });
  });
});
