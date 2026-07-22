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

import { toast } from "@sico/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SandboxInstance } from "@/features/chat/components/sidepane/previewers/sandbox/sandbox-instance";
import type { Sandbox } from "@/features/sandbox/schemas/sandbox";

// Partial-mock @sico/ui: stub `toast` (the exit announcement fires it as a
// bare inverted toast) while every other export stays real so Button/dropdown
// still render (mirrors composer.test.tsx).
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: vi.fn(),
  };
});

const mockedToast = vi.mocked(toast);

beforeEach(() => {
  mockedToast.mockClear();
});

function device(overrides: Partial<Sandbox>): Sandbox {
  return {
    sandboxId: "sb-1",
    displayName: "Pixel 7",
    type: "emulator",
    status: "in_use",
    vncUrl: "https://vnc.example/sb-1",
    ...overrides,
  };
}

function renderInstance(
  selected: Sandbox,
  all: Sandbox[] = [selected],
): ReturnType<typeof render> {
  return render(
    (
      <Provider store={createStore()}>
        <SandboxInstance
          sandboxes={all}
          selected={selected}
          onSelect={vi.fn()}
          onViewAll={vi.fn()}
        />
      </Provider>
    ) as ReactElement,
  );
}

describe("SandboxInstance — take-over", () => {
  it("renders the live VNC iframe for the selected device", () => {
    renderInstance(device({ vncUrl: "https://vnc.example/sb-1" }));
    expect(screen.getByTitle("Pixel 7 live view")).toHaveAttribute(
      "src",
      "https://vnc.example/sb-1",
    );
  });

  it("overlays a spinner until the live frame loads", () => {
    renderInstance(device({}));
    // Before the frame paints, the loading overlay's spinner is shown.
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.load(screen.getByTitle("Pixel 7 live view"));
    // Once it loads, the overlay is gone.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("blocks a non-https VNC url instead of mounting an un-sandboxed frame", () => {
    // Built from the scheme so the literal never reads as a `javascript:` URL
    // (ESLint's no-script-url flags such literals); the gate must reject it.
    const scheme = "javascript";
    renderInstance(device({ vncUrl: `${scheme}:alert(1)` }));
    // The gate refuses the url → no live frame, a message instead.
    expect(screen.queryByTitle("Pixel 7 live view")).not.toBeInTheDocument();
    expect(
      screen.getByText("This device's live view is unavailable."),
    ).toBeInTheDocument();
  });

  it("toggles the take-over button label on click", async () => {
    const user = userEvent.setup();
    renderInstance(device({}));
    await user.click(screen.getByRole("button", { name: /take over/i }));
    expect(
      screen.getByRole("button", { name: /stop take over/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("does not toast when entering take-over", async () => {
    const user = userEvent.setup();
    renderInstance(device({}));
    await user.click(screen.getByRole("button", { name: /take over/i }));
    expect(mockedToast).not.toHaveBeenCalled();
  });

  it("toasts that the device is view-only when the button stops take-over", async () => {
    const user = userEvent.setup();
    renderInstance(device({}));
    await user.click(screen.getByRole("button", { name: /take over/i }));
    await user.click(screen.getByRole("button", { name: /stop take over/i }));
    expect(mockedToast).toHaveBeenCalledWith(
      "Take over ended. Device is now view-only.",
      { invert: true },
    );
  });

  describe("non-emulator (aio/wincua) overlay gating", () => {
    it("blocks input with an overlay until take-over, then shows the badge", async () => {
      const user = userEvent.setup();
      renderInstance(device({ type: "aio" }));
      // View-only: the blocking overlay is present, no badge.
      expect(screen.getByTestId("sandbox-input-block")).toBeInTheDocument();
      expect(screen.queryByText("You are taking over")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /take over/i }));
      // Taking over: overlay gone, badge shown.
      expect(
        screen.queryByTestId("sandbox-input-block"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("You are taking over")).toBeInTheDocument();
    });

    it("never shows the overlay/badge for an emulator (in-frame UI)", () => {
      renderInstance(device({ type: "emulator" }));
      expect(
        screen.queryByTestId("sandbox-input-block"),
      ).not.toBeInTheDocument();
    });
  });

  describe("idle timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("auto-exits take-over after 5 minutes of no activity", () => {
      renderInstance(device({ type: "aio" }));
      // fireEvent (not userEvent) toggles take-over with a single synthetic
      // click — userEvent's pointer-move stream would itself re-arm the idle
      // timer this test is trying to let expire.
      fireEvent.click(screen.getByRole("button", { name: /take over/i }));
      expect(
        screen.getByRole("button", { name: /stop take over/i }),
      ).toBeInTheDocument();
      // 5 minutes with no tracked activity → back to view-only.
      act(() => {
        vi.advanceTimersByTime(5 * 60 * 1000);
      });
      expect(
        screen.getByRole("button", { name: /take over/i }),
      ).toHaveAttribute("aria-pressed", "false");
      // The idle exit announces the release just like the button does.
      expect(mockedToast).toHaveBeenCalledWith(
        "Take over ended. Device is now view-only.",
        { invert: true },
      );
    });

    it("re-arms the idle timer on an in-frame activity message", () => {
      renderInstance(
        device({ type: "aio", vncUrl: "https://vnc.example/sb-1" }),
      );
      fireEvent.click(screen.getByRole("button", { name: /take over/i }));
      // Just shy of the timeout, the frame reports in-frame input (the future
      // backend signal) → the timer re-arms and take-over survives the 5-min mark.
      act(() => {
        vi.advanceTimersByTime(4 * 60 * 1000);
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://vnc.example",
            data: { type: "sandboxActivity" },
          }),
        );
        vi.advanceTimersByTime(2 * 60 * 1000);
      });
      expect(
        screen.getByRole("button", { name: /stop take over/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("ignores an activity message from a foreign origin", () => {
      renderInstance(
        device({ type: "aio", vncUrl: "https://vnc.example/sb-1" }),
      );
      fireEvent.click(screen.getByRole("button", { name: /take over/i }));
      act(() => {
        vi.advanceTimersByTime(4 * 60 * 1000);
        // An unrelated page must NOT be able to keep the session alive.
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://evil.example",
            data: { type: "sandboxActivity" },
          }),
        );
        vi.advanceTimersByTime(2 * 60 * 1000);
      });
      expect(
        screen.getByRole("button", { name: /take over/i }),
      ).toHaveAttribute("aria-pressed", "false");
    });
  });
});

describe("SandboxInstance — header (legacy parity)", () => {
  it("omits the 'Device' title word — the dropdown names the device", () => {
    renderInstance(device({ displayName: "AIO-Device #2", type: "aio" }));
    // Legacy SandboxInstance has no title; the device dropdown carries the name.
    expect(screen.queryByText("Device")).not.toBeInTheDocument();
    expect(screen.getByText("AIO-Device #2")).toBeInTheDocument();
  });
});
