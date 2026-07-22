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
import { describe, expect, it, vi } from "vitest";

import { ToolItem } from "@/features/skill/components/tools/tool-item";

describe("ToolItem", () => {
  it("renders the tool name and, once expanded, its editable fields", () => {
    render(
      <ToolItem
        action={{
          name: "vector search",
          description: "find docs",
          advancedSettings: "",
        }}
        defaultExpanded
        onChange={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: /vector search/i });
    expect(screen.getByPlaceholderText("Enter tool name")).toHaveValue(
      "vector search",
    );
    expect(
      screen.getByPlaceholderText("Describe what this tool does"),
    ).toHaveValue("find docs");
  });

  it("patches the action when a field changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToolItem
        action={{ name: "search", description: "", advancedSettings: "" }}
        defaultExpanded
        onChange={onChange}
      />,
    );
    await user.type(screen.getByPlaceholderText("Enter tool name"), "!");
    expect(onChange).toHaveBeenCalledWith({
      name: "search!",
      description: "",
      advancedSettings: "",
    });
  });
});
