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
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { SandboxPreviewer } from "@/features/chat/components/sidepane/previewers/sandbox-previewer";
import { useSandboxInstancesQuery } from "@/features/sandbox/hooks/use-sandbox-instances-query";
import type { Sandbox } from "@/features/sandbox/schemas/sandbox";

// The previewer drives its whole machine off this one query — mock it to feed
// each state (pending / error / list / single device) without a live fetch.
vi.mock("@/features/sandbox/hooks/use-sandbox-instances-query", () => ({
  useSandboxInstancesQuery: vi.fn(),
}));

type SandboxContent = Extract<SidepaneContent, { kind: "sandbox" }>;
const content: SandboxContent = { kind: "sandbox", agentInstanceId: 413 };

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

function mockQuery(overrides: Record<string, unknown>): void {
  vi.mocked(useSandboxInstancesQuery).mockReturnValue({
    isPending: false,
    isError: false,
    data: [],
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as never);
}

// SidepaneHeader reads useSidepane() → needs a jotai store (sibling previewers
// render under one the same way).
function renderUnderStore(ui: ReactElement): ReturnType<typeof render> {
  return render(<Provider store={createStore()}>{ui}</Provider>);
}

beforeEach(() => {
  vi.mocked(useSandboxInstancesQuery).mockReset();
});

describe("SandboxPreviewer", () => {
  it("shows a loading spinner while the device list is pending", () => {
    mockQuery({ isPending: true, data: undefined });
    renderUnderStore(<SandboxPreviewer content={content} />);
    expect(screen.getByLabelText("Loading devices")).toBeInTheDocument();
  });

  it("shows an error state with retry when the list fails", () => {
    mockQuery({ isError: true, data: undefined, error: new Error("boom") });
    renderUnderStore(<SandboxPreviewer content={content} />);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("renders the device grid when multiple devices are present", () => {
    mockQuery({
      data: [
        device({ sandboxId: "a", displayName: "Pixel 7" }),
        device({ sandboxId: "b", displayName: "Galaxy S24" }),
      ],
    });
    renderUnderStore(<SandboxPreviewer content={content} />);
    expect(screen.getByText("Pixel 7")).toBeInTheDocument();
    expect(screen.getByText("Galaxy S24")).toBeInTheDocument();
  });

  it("auto-drills into the instance view when there is a single device", () => {
    mockQuery({ data: [device({ displayName: "Pixel 7" })] });
    renderUnderStore(<SandboxPreviewer content={content} />);
    // Instance view: the take-over toggle is only on the single-device screen.
    expect(
      screen.getByRole("button", { name: /take over/i }),
    ).toBeInTheDocument();
  });

  it("returns to the grid on 'View all' even with a single device", async () => {
    const user = userEvent.setup();
    mockQuery({ data: [device({ displayName: "Pixel 7" })] });
    renderUnderStore(<SandboxPreviewer content={content} />);
    // Lone device auto-drilled into the instance; open its dropdown → View all.
    await user.click(screen.getByRole("button", { name: "Pixel 7" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /view all/i }),
    );
    // The grid must hold: the auto-drill no longer yanks the lone device back,
    // so the take-over toggle (instance-only) is gone.
    expect(
      screen.queryByRole("button", { name: /take over/i }),
    ).not.toBeInTheDocument();
  });

  it("drills from the grid into a device on click", async () => {
    const user = userEvent.setup();
    mockQuery({
      data: [
        device({ sandboxId: "a", displayName: "Pixel 7" }),
        device({ sandboxId: "b", displayName: "Galaxy S24" }),
      ],
    });
    renderUnderStore(<SandboxPreviewer content={content} />);
    await user.click(screen.getByText("Galaxy S24"));
    expect(
      screen.getByRole("button", { name: /take over/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty copy when there are no devices", () => {
    mockQuery({ data: [] });
    renderUnderStore(<SandboxPreviewer content={content} />);
    expect(screen.getByText("No devices available.")).toBeInTheDocument();
  });
});
