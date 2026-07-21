import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SuggestedTasksSkeleton } from "@/features/chat/components/digital-worker-home/suggested-tasks-skeleton";

describe("SuggestedTasksSkeleton", () => {
  it("shows the suggested-tasks divider label", () => {
    render(<SuggestedTasksSkeleton />);
    expect(screen.getByText(/suggested tasks/i)).toBeInTheDocument();
  });

  it("renders three placeholder rows (chip + line each)", () => {
    const { container } = render(<SuggestedTasksSkeleton />);
    // 3 rows × (icon-chip skeleton + message-line skeleton) = 6 placeholders.
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      6,
    );
  });

  it("renders no task buttons (it is a loading placeholder)", () => {
    render(<SuggestedTasksSkeleton />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
