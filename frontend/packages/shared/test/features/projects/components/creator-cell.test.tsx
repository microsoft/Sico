import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreatorCell } from "@/features/projects/components/creator-cell";

describe("<CreatorCell>", () => {
  it("renders the username beside a user avatar for a user creator", () => {
    render(<CreatorCell creator={{ kind: "user", username: "alice" }} />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    // Both avatars render a `data-testid="avatar-root"` root.
    expect(screen.getByTestId("avatar-root")).toBeInTheDocument();
  });

  it("falls back to the 'Digital worker' label when an agent creator has no name", () => {
    render(<CreatorCell creator={{ kind: "agent", agentInstanceId: 7 }} />);

    // Missing name (older rows) → the cell still names the creator with the
    // generic label beside a decorative avatar, never a blank cell.
    expect(screen.getByText("Digital worker")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-root")).toBeInTheDocument();
  });

  it("renders the agentName beside a DW avatar when the wire carries it", () => {
    render(
      <CreatorCell
        creator={{
          kind: "agent",
          agentInstanceId: 7,
          agentName: "Max",
          iconUrl: "/icons/max.svg",
        }}
      />,
    );

    // The name rides on extraInfo.agentInstance → visible text beside a
    // decorative avatar (mirrors the user branch), not the generic label.
    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-root")).toBeInTheDocument();
    expect(screen.queryByText("Digital worker")).not.toBeInTheDocument();
  });
});
