import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SuggestedTasks } from "@/features/chat/components/digital-worker-home/suggested-tasks";
import { type RecommendationTask } from "@/features/chat/schemas/recommendation-task";

// The component suspends on the recommendation fetch; stub the hook at its
// module boundary so the test drives the resolved list directly (loading is the
// parent's Suspense fallback, covered by suggested-tasks-skeleton.test).
const tasksRef = vi.fn<() => RecommendationTask[]>();
vi.mock("@/features/chat/hooks/use-recommendation-tasks", () => ({
  useSuspenseRecommendationTasks: () => tasksRef(),
}));

const tasks: RecommendationTask[] = [
  { message: "Automate regression", icon: 2 },
  { message: "Add smoke tests", icon: 4 },
];

describe("SuggestedTasks", () => {
  it("renders nothing when the resolved list is empty", () => {
    tasksRef.mockReturnValue([]);
    const { container } = render(
      <SuggestedTasks agentInstanceId={1} onSelect={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the divider label when tasks resolved", () => {
    tasksRef.mockReturnValue(tasks);
    render(<SuggestedTasks agentInstanceId={1} onSelect={vi.fn()} />);
    expect(screen.getByText(/suggested tasks/i)).toBeInTheDocument();
  });

  it("renders one button per resolved task", () => {
    tasksRef.mockReturnValue(tasks);
    render(<SuggestedTasks agentInstanceId={1} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("renders each task's message", () => {
    tasksRef.mockReturnValue(tasks);
    render(<SuggestedTasks agentInstanceId={1} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Add smoke tests/ }),
    ).toBeInTheDocument();
  });
});
