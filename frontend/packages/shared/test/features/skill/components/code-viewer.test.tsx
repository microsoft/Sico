import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { CodeViewer } from "@/features/skill/components/file-explorer/code-viewer";

// CodeMirror can't render in jsdom (it needs layout APIs like getClientRects).
// Mock it down to a controlled element so the test exercises CodeViewer's own
// wiring (read-only vs editable, value, onChange) rather than CodeMirror's DOM.
vi.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  EditorView: { theme: () => ({}), lineWrapping: {} },
  default: ({
    value,
    editable,
    onChange,
  }: {
    value: string;
    editable?: boolean;
    onChange?: (value: string) => void;
  }): ReactElement =>
    editable === true ? (
      <textarea
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ) : (
      <div>{value}</div>
    ),
}));

const file = { path: "skill.md", content: "# hi" };

describe("CodeViewer", () => {
  it("renders read-only content when not editable", () => {
    render(<CodeViewer file={file} editable={false} />);
    screen.getByText("# hi");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("emits changes when editable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CodeViewer file={file} editable onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "!");
    expect(onChange).toHaveBeenCalled();
  });
});
