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
