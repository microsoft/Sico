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
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ComposerSendButton } from "@/features/chat/components/composer-send-button";

// The send-area state machine (§7): ■ Stop while streaming → ↻ loading in the
// pending (↻) window → → Send when text is present, else nothing. The Stop glyph
// must be a FILLED square (Figma 6893:53472: a solid stop icon on a gray
// circle), not lucide's hollow outline.

const noop = (): void => {};

// Default all state flags off; each test flips only what it asserts.
// `createElement` (not JSX spread) keeps the prop-defaulting without tripping
// `react/jsx-props-no-spreading`.
function renderButton(
  overrides: Partial<React.ComponentProps<typeof ComposerSendButton>> = {},
): void {
  render(
    createElement(ComposerSendButton, {
      isStreaming: false,
      isRequestPending: false,
      submitting: false,
      showSend: false,
      disabled: false,
      onSend: noop,
      onStop: noop,
      ...overrides,
    }),
  );
}

describe("ComposerSendButton", () => {
  it("shows the Stop button (dark filled square on a light circle) while streaming", () => {
    renderButton({ isStreaming: true });
    const button = screen.getByRole("button", { name: "Stop response" });
    expect(button).toHaveClass("rounded-full");
    // Figma 6893:53472: gray circle (secondary/2 #e2e1de = neutral-200).
    expect(button).toHaveClass("bg-neutral-200");
    // The glyph is a dark (foreground-primary #2D3339) solid square.
    const glyph = button.querySelector("svg");
    expect(glyph).toHaveClass("fill-current");
    expect(glyph).toHaveClass("text-foreground-primary");
  });

  it("shows the loading button in the pending (↻) window", () => {
    renderButton({ isRequestPending: true });
    const button = screen.getByRole("button", { name: "Stop request" });
    expect(button).toHaveClass("rounded-full");
    expect(button.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the Send button when text is present and not streaming", () => {
    renderButton({ showSend: true });
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });

  it("renders nothing when idle with no text", () => {
    const { container } = render(
      createElement(ComposerSendButton, {
        isStreaming: false,
        isRequestPending: false,
        submitting: false,
        showSend: false,
        disabled: false,
        onSend: noop,
        onStop: noop,
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a non-stoppable spinner labeled 'Sending…' while submitting", () => {
    renderButton({ submitting: true });
    const button = screen.getByRole("button", { name: "Sending…" });
    expect(button.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does not call onStop or onSend when the submitting spinner is clicked", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onSend = vi.fn();
    // submitting takes precedence even if showSend would otherwise render Send.
    renderButton({ submitting: true, showSend: true, onStop, onSend });
    await user.click(screen.getByRole("button", { name: "Sending…" }));
    expect(onStop).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
