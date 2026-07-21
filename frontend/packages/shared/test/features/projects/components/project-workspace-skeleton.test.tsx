import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectWorkspaceSkeleton } from "@/features/projects/components/project-workspace-skeleton";

describe("<ProjectWorkspaceSkeleton>", () => {
  it("exposes a single content-shaped loading status for the workspace", () => {
    render(<ProjectWorkspaceSkeleton />);

    expect(
      screen.getByRole("status", { name: /loading project/i }),
    ).toBeInTheDocument();
    // The right panel composes ProjectDrawerSkeleton — it must NOT add its own
    // nested status region (the workspace owns the single one), mirroring the
    // ProjectsGridSkeleton → aria-hidden ProjectCardSkeleton building block.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("mirrors the drawer on the right by composing ProjectDrawerSkeleton", () => {
    render(<ProjectWorkspaceSkeleton />);

    // The crude 4-bar panel is replaced by the real drawer-shaped skeleton, so
    // the right column does not reflow into the rich ProjectDrawer when the
    // project-detail + knowledge tags queries resolve.
    expect(screen.getByTestId("project-drawer-skeleton")).toBeInTheDocument();
  });
});
