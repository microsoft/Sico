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

import { ComposerInput } from "@/features/chat/components/composer-input";

describe("ComposerInput", () => {
  it("calls onChange as the user types", async () => {
    const onChange = vi.fn();
    render(<ComposerInput value="" onChange={onChange} onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Message input"), "hi");
    expect(onChange).toHaveBeenCalled();
  });

  it("submits on Enter when not composing", async () => {
    const onSubmit = vi.fn();
    render(<ComposerInput value="hi" onChange={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Message input");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does NOT submit on Shift+Enter (newline)", async () => {
    const onSubmit = vi.fn();
    render(<ComposerInput value="hi" onChange={vi.fn()} onSubmit={onSubmit} />);
    screen.getByLabelText("Message input").focus();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does NOT submit on Enter while IME composing", () => {
    const onSubmit = vi.fn();
    render(<ComposerInput value="あ" onChange={vi.fn()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Message input");
    // Simulate a composing Enter (isComposing true). Set it via the
    // KeyboardEvent init dict: isComposing is a getter-only prop, so
    // Object.assign-ing it onto a constructed event throws "only has a
    // getter" in both jsdom and real browsers.
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
