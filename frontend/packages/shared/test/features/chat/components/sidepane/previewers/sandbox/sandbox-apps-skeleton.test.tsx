import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxAppsSkeleton } from "@/features/chat/components/sidepane/previewers/sandbox/sandbox-apps-skeleton";

describe("<SandboxAppsSkeleton>", () => {
  it("exposes a loading status for assistive tech", () => {
    render(<SandboxAppsSkeleton />);
    expect(screen.getByRole("status", { name: "Loading apps" })).toBeVisible();
  });

  it("renders a fixed set of placeholder rows", () => {
    render(<SandboxAppsSkeleton />);
    expect(screen.getAllByTestId("apps-skeleton-row")).toHaveLength(5);
  });

  it("keeps the real column headers so the layout does not reflow", () => {
    render(<SandboxAppsSkeleton />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Version" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeVisible();
  });
});
