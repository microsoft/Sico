import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileTree } from "@/features/skill/components/file-explorer/file-tree";

const files = [
  { path: "skill.md", content: "# hi" },
  { path: "notes.txt", content: "hello" },
];

describe("FileTree", () => {
  it("renders each path and reports a selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FileTree files={files} selectedPath="skill.md" onSelect={onSelect} />,
    );
    screen.getByRole("button", { name: "skill.md" });
    await user.click(screen.getByRole("button", { name: "notes.txt" }));
    expect(onSelect).toHaveBeenCalledWith("notes.txt");
  });
});
