import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileExplorer } from "@/features/skill/components/file-explorer/file-explorer";
import type { SkillFile } from "@/features/skill/schemas/skill";

// CodeMirror can't render in jsdom (it needs layout APIs like getClientRects).
// Mock CodeViewer down to a controlled element so these tests exercise
// FileExplorer's own selection/edit wiring rather than CodeMirror's DOM. The
// mock mirrors CodeViewer's real accessible name (`edit|view {path}`) so
// label-based queries match the production contract.
vi.mock("@/features/skill/components/file-explorer/code-viewer", () => ({
  CodeViewer: ({
    file,
    editable,
    onChange,
  }: {
    file: SkillFile;
    editable: boolean;
    onChange?: (content: string) => void;
  }): ReactElement =>
    editable ? (
      <textarea
        aria-label={`edit ${file.path}`}
        value={file.content}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ) : (
      <div>{file.content}</div>
    ),
}));

const files = [
  { path: "skill.md", content: "# hi" },
  { path: "notes.txt", content: "hello" },
];

describe("FileExplorer", () => {
  it("shows the first file by default and switches on selection", async () => {
    const user = userEvent.setup();
    render(<FileExplorer files={files} editable={false} />);
    screen.getByText("# hi");
    await user.click(screen.getByRole("button", { name: "notes.txt" }));
    screen.getByText("hello");
  });

  it("propagates edits with the file path", async () => {
    const user = userEvent.setup();
    const onContentChange = vi.fn();
    render(
      <FileExplorer files={files} editable onContentChange={onContentChange} />,
    );
    await user.type(screen.getByRole("textbox"), "!");
    expect(onContentChange).toHaveBeenCalledWith(
      "skill.md",
      expect.any(String),
    );
  });
});
