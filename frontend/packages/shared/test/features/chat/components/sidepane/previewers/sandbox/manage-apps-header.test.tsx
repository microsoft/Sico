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

import { ManageAppsHeader } from "@/features/chat/components/sidepane/previewers/sandbox/manage-apps-header";
import { useSidepane } from "@/features/chat/hooks/use-sidepane";

// The header reads maximize state + wires the maximize/close controls straight
// to useSidepane() (same contract as SidepaneHeader) — mock it to assert the
// wiring without a jotai store.
vi.mock("@/features/chat/hooks/use-sidepane", () => ({
  useSidepane: vi.fn(),
}));

function mockSidepane(overrides: Record<string, unknown> = {}): {
  close: ReturnType<typeof vi.fn>;
  toggleMaximize: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const toggleMaximize = vi.fn();
  vi.mocked(useSidepane).mockReturnValue({
    content: null,
    maximized: false,
    open: vi.fn(),
    close,
    toggleMaximize,
    ...overrides,
  } as never);
  return { close, toggleMaximize };
}

describe("<ManageAppsHeader>", () => {
  it("calls onBack when the back button is clicked", async () => {
    const user = userEvent.setup();
    mockSidepane();
    const onBack = vi.fn();
    render(<ManageAppsHeader onBack={onBack} />);
    await user.click(screen.getByRole("button", { name: "Back to device" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("toggles maximize from the header", async () => {
    const user = userEvent.setup();
    const { toggleMaximize } = mockSidepane();
    render(<ManageAppsHeader onBack={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    expect(toggleMaximize).toHaveBeenCalledOnce();
  });

  it("shows the Restore label when the sidepane is maximized", () => {
    mockSidepane({ maximized: true });
    render(<ManageAppsHeader onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("closes the sidepane from the header", async () => {
    const user = userEvent.setup();
    const { close } = mockSidepane();
    render(<ManageAppsHeader onBack={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledOnce();
  });
});
