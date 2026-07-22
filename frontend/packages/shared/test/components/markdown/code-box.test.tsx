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
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeBox } from "@/components/markdown/code-box";

// Every `className` below is a react-markdown fenced-code token (`language-*`),
// CodeBox's real prop contract — not a Tailwind class. Disable the Tailwind
// custom-classname check for this file rather than tokenizing a non-Tailwind input.
/* eslint-disable tailwindcss/no-custom-classname -- `language-*` is react-markdown's fenced-code class, not Tailwind */

// Stub the toast surface so the copy-confirmation / copy-error assertions are
// observable; everything else in `@sico/ui` stays real.
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

// A controllable clipboard. Each test installs its own writeText so the
// resolve/reject paths are exercised independently; jsdom ships no real one.
function mockClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodeBox", () => {
  it("renders the language label from a language- class (fallback 'text')", () => {
    const { rerender } = render(
      <CodeBox className="language-typescript">const a = 1;</CodeBox>,
    );
    expect(screen.getByText("typescript")).toBeInTheDocument();
    rerender(<CodeBox>plain</CodeBox>);
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("highlights via PrismLight for a registered language", () => {
    render(<CodeBox className="language-json">{'{ "k": 1 }'}</CodeBox>);
    // PrismLight wraps tokens in styled <span>s — a plain <pre> text node would
    // have none. The presence of token spans proves the highlighter ran.
    const code = screen.getByText(/"k"/);
    expect(code.closest("span")).not.toBeNull();
  });

  it("copies the code text to the clipboard on copy-button click", async () => {
    mockClipboard(() => Promise.resolve());
    const { toast } = await import("@sico/ui");
    render(<CodeBox className="language-bash">{"echo hi\n"}</CodeBox>);

    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));

    // Trailing newline is trimmed (legacy parity), and the confirmation fires.
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("echo hi");
    expect(toast.success).toHaveBeenCalled();
  });

  it("surfaces an error (no throw) when clipboard write rejects", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    const { toast } = await import("@sico/ui");
    render(<CodeBox className="language-bash">echo hi</CodeBox>);

    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("copy button exposes an accessible name", () => {
    render(<CodeBox className="language-go">package main</CodeBox>);
    expect(
      screen.getByRole("button", { name: "Copy code" }),
    ).toBeInTheDocument();
  });

  it("renders a still-open (unclosed) fence without crashing (streaming tail)", () => {
    // No closing fence yet — the live tail during streaming. Must render the
    // partial body, not throw. PrismLight splits source across token spans, so
    // assert on the assembled text content rather than a single text node.
    const { container } = render(
      <CodeBox className="language-python">{"def f():\n    return"}</CodeBox>,
    );
    expect(container.textContent).toContain("def f():");
  });

  it("uses no hardcoded hex / no styled-components (token classes only)", () => {
    const { container } = render(
      <CodeBox className="language-ts">const a = 1;</CodeBox>,
    );
    // No inline hex anywhere in the card's own markup (the prism theme styles
    // the inner tokens, but the card chrome is token classes only).
    const card = container.firstElementChild;
    expect(card?.className).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(card?.getAttribute("style") ?? "").not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
