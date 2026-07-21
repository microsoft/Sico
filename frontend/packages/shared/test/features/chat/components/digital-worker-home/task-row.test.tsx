import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskRow } from "@/features/chat/components/digital-worker-home/task-row";
import { RecommendationTaskIconSchema } from "@/features/chat/schemas/recommendation-task";

const task = { message: "Automate regression scenarios", icon: 2 };

describe("TaskRow", () => {
  it("renders the task message", () => {
    render(<TaskRow task={task} index={0} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Automate regression scenarios/ }),
    ).toBeInTheDocument();
  });

  it("calls onSelect with the message when clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TaskRow task={task} index={0} onSelect={onSelect} />);
    await user.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("Automate regression scenarios");
  });

  it("staggers the reveal with an index-derived animation delay", () => {
    render(<TaskRow task={task} index={2} onSelect={vi.fn()} />);
    // Legacy timing: 240ms base + an extra 80ms once the first row has landed.
    expect(screen.getByRole("button")).toHaveStyle({ animationDelay: "320ms" });
  });

  it("starts the first row's reveal at the section-label delay (no extra offset)", () => {
    render(<TaskRow task={task} index={0} onSelect={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveStyle({ animationDelay: "240ms" });
  });

  it("renders an unknown icon code without throwing (fallback glyph)", () => {
    render(
      <TaskRow
        task={{ message: "x", icon: 99 }}
        index={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "x" })).toBeInTheDocument();
  });

  it("renders the research icon code", () => {
    render(
      <TaskRow
        task={{
          message: "Research",
          icon: RecommendationTaskIconSchema.enum.RESEARCH,
        }}
        index={0}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Research" }),
    ).toBeInTheDocument();
  });
});
