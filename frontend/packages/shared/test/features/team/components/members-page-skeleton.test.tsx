import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersPageSkeleton } from "@/features/team/components/members-page-skeleton";

describe("MembersPageSkeleton", () => {
  it("exposes a single loading status region", () => {
    render(<MembersPageSkeleton activeTab="humans" />);
    expect(
      screen.getByRole("status", { name: "Loading members" }),
    ).toBeInTheDocument();
  });

  it("mirrors the humans table headers", () => {
    render(<MembersPageSkeleton activeTab="humans" />);
    // The table is aria-hidden inside the page status region, so query by text.
    expect(screen.getByText("ROLE")).toBeInTheDocument();
    expect(screen.queryByText("SANDBOX")).not.toBeInTheDocument();
  });

  it("mirrors the digital-workers table headers", () => {
    render(<MembersPageSkeleton activeTab="workers" />);
    expect(screen.getByText("OPERATOR")).toBeInTheDocument();
    expect(screen.queryByText("ROLE")).not.toBeInTheDocument();
  });
});
