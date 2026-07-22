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

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxThumbnail } from "@/features/sandbox/components/sandbox-thumbnail";
import type { Sandbox } from "@/features/sandbox/schemas/sandbox";

function device(overrides: Partial<Sandbox> = {}): Sandbox {
  return {
    sandboxId: "sb-1",
    displayName: "Pixel 7",
    type: "emulator",
    status: "in_use",
    vncUrl: "https://vnc.example/sb-1",
    ...overrides,
  };
}

describe("SandboxThumbnail", () => {
  it("renders the VNC frame view-only (no pointer events, not focusable)", () => {
    render(<SandboxThumbnail sandbox={device()} />);
    const frame = screen.getByTitle("Pixel 7 preview");
    expect(frame).toHaveAttribute("src", "https://vnc.example/sb-1");
    expect(frame).toHaveAttribute("tabindex", "-1");
    expect(frame).toHaveClass("pointer-events-none");
  });

  it("fades the frame in only once it has loaded", () => {
    render(<SandboxThumbnail sandbox={device()} />);
    const frame = screen.getByTitle("Pixel 7 preview");
    // Hidden until it paints, so the card shows its placeholder, not a flash.
    expect(frame).toHaveClass("opacity-0");
    fireEvent.load(frame);
    expect(frame).toHaveClass("opacity-100");
  });

  it("re-hides the frame when the device url changes (no stale fade-in)", () => {
    const { rerender } = render(<SandboxThumbnail sandbox={device()} />);
    fireEvent.load(screen.getByTitle("Pixel 7 preview"));
    expect(screen.getByTitle("Pixel 7 preview")).toHaveClass("opacity-100");
    // A poll swaps this card's url — the frame must spin (opacity-0) again, not
    // flash the prior device's last paint.
    rerender(
      <SandboxThumbnail
        sandbox={device({ vncUrl: "https://vnc.example/v2" })}
      />,
    );
    expect(screen.getByTitle("Pixel 7 preview")).toHaveClass("opacity-0");
  });

  it("renders nothing for a non-https url (blocked by the gate)", () => {
    const scheme = "javascript";
    render(
      <SandboxThumbnail sandbox={device({ vncUrl: `${scheme}:alert(1)` })} />,
    );
    expect(screen.queryByTitle("Pixel 7 preview")).not.toBeInTheDocument();
  });
});
