import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavBadge } from "@/features/sidebar/components/nav-badge";
import { NavRow } from "@/features/sidebar/components/nav-row";
import { RailNavRow } from "@/features/sidebar/components/rail-nav-row";

describe("<NavRow>", () => {
  it("renders icon, label, and trailing in order inside the provided element", () => {
    render(
      <NavRow
        icon={<span data-testid="icon" />}
        label="Notification"
        trailing={<span data-testid="trailing" />}
        render={<button type="button" />}
      />,
    );
    const button = screen.getByRole("button", { name: /notification/i });
    const icon = screen.getByTestId("icon");
    const trailing = screen.getByTestId("trailing");
    expect(button).toContainElement(icon);
    expect(button).toContainElement(trailing);
    // icon precedes trailing in document order (label sits between them).
    expect(
      // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
      icon.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders as the caller's element type (button)", () => {
    render(<NavRow icon={null} label="X" render={<button type="button" />} />);
    expect(screen.getByRole("button", { name: "X" })).toBeVisible();
  });

  it("applies the shared row chrome onto the rendered element", () => {
    render(<NavRow icon={null} label="X" render={<button type="button" />} />);
    expect(screen.getByRole("button", { name: "X" })).toHaveClass(
      "h-9",
      "rounded-lg",
      "px-2",
    );
  });

  it("merges the caller's className with the row chrome", () => {
    render(
      <NavRow
        icon={null}
        label="X"
        render={<button type="button" className="opacity-50" />}
      />,
    );
    const button = screen.getByRole("button", { name: "X" });
    expect(button).toHaveClass("opacity-50");
    expect(button).toHaveClass("h-9");
  });

  it("sets data-active when active", () => {
    render(
      <NavRow icon={null} label="X" active render={<button type="button" />} />,
    );
    expect(screen.getByRole("button", { name: "X" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("omits data-active when not active", () => {
    render(<NavRow icon={null} label="X" render={<button type="button" />} />);
    expect(screen.getByRole("button", { name: "X" })).not.toHaveAttribute(
      "data-active",
    );
  });
});

describe("<RailNavRow>", () => {
  it("renders only the icon inside the provided element (no label text)", () => {
    render(
      <RailNavRow
        icon={<span data-testid="rail-icon" />}
        render={<button type="button" aria-label="Notification" />}
      />,
    );
    const button = screen.getByRole("button", { name: "Notification" });
    expect(button).toContainElement(screen.getByTestId("rail-icon"));
    expect(button).toHaveTextContent("");
  });

  it("applies the centered square rail chrome", () => {
    render(
      <RailNavRow
        icon={null}
        render={<button type="button" aria-label="X" />}
      />,
    );
    expect(screen.getByRole("button", { name: "X" })).toHaveClass(
      "size-9",
      "justify-center",
      "rounded-lg",
    );
  });
});

describe("<NavBadge>", () => {
  it("renders its count content", () => {
    render(<NavBadge>99+</NavBadge>);
    expect(screen.getByText("99+")).toBeVisible();
  });

  it("renders the count pill with the danger badge chrome", () => {
    render(<NavBadge>3</NavBadge>);
    expect(screen.getByText("3")).toHaveClass(
      "bg-danger-500",
      "text-foreground-on-inverted",
      "rounded-full",
    );
  });
});
