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
