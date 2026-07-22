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
import { describe, expect, it, vi } from "vitest";

import { SandboxApps } from "@/features/chat/components/sidepane/previewers/sandbox/sandbox-apps";
import { useEmulatorAppsQuery } from "@/features/sandbox/hooks/use-emulator-apps-query";
import type { EmulatorAppsDeviceResult } from "@/features/sandbox/schemas/emulator-app";
import type { Sandbox } from "@/features/sandbox/schemas/sandbox";

// The panel drives its app list off this query — mock it to feed a device's app
// set without a live fetch. The install-actions hook only wires mutations/toasts
// (not the list), so a static stub keeps the panel inert.
vi.mock("@/features/sandbox/hooks/use-emulator-apps-query", () => ({
  useEmulatorAppsQuery: vi.fn(),
}));
vi.mock("@/features/sandbox/hooks/use-app-install-actions", () => ({
  useAppInstallActions: (): Record<string, unknown> => ({
    installPending: false,
    uninstallPending: false,
    runInstall: vi.fn(),
    runUninstall: vi.fn(),
  }),
}));

function device(
  apps: EmulatorAppsDeviceResult["apps"],
  sandboxId = "sb-1",
  displayName = "Pixel 7",
): EmulatorAppsDeviceResult {
  return { sandboxId, displayName, apps };
}

const deviceMeta: Sandbox = {
  sandboxId: "sb-1",
  displayName: "Pixel 7",
  type: "emulator",
  status: "in_use",
  vncUrl: "https://vnc.example/sb-1",
};

function meta(sandboxId: string, displayName: string): Sandbox {
  return { ...deviceMeta, sandboxId, displayName };
}

function mockApps(data: EmulatorAppsDeviceResult[]): void {
  vi.mocked(useEmulatorAppsQuery).mockReturnValue({
    data,
  } as never);
}

describe("<SandboxApps>", () => {
  it("drops apps with a blank name — the backend returns nameless system apps", () => {
    mockApps([
      device([
        { appName: "", package: "com.android.systemui", version: "" },
        { appName: "", package: "com.google.gsf", version: "12" },
        { appName: "Edge", package: "com.microsoft.emmx", version: "149.0" },
      ]),
    ]);
    render(
      <SandboxApps
        agentInstanceId={1}
        devices={[deviceMeta]}
        onBack={vi.fn()}
      />,
    );
    // The one named app renders; the two nameless rows must not. Count the
    // per-row action buttons (one per rendered app) — nameless rows would push
    // this above 1. (An exact `name: "Actions for "` query can't be used: RTL
    // trims the trailing space off the accessible name.)
    expect(screen.getByText("Edge")).toBeVisible();
    const actionButtons = screen
      .getAllByRole("button")
      .filter((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Actions for"),
      );
    expect(actionButtons).toHaveLength(1);
  });

  it("falls back to a surviving device when the selected one drops out of the list", () => {
    mockApps([
      device(
        [{ appName: "Maps", package: "com.maps", version: "1.0" }],
        "sb-1",
      ),
      device(
        [{ appName: "Edge", package: "com.microsoft.emmx", version: "149.0" }],
        "sb-2",
        "Pixel 8",
      ),
    ]);
    const { rerender } = render(
      <SandboxApps
        agentInstanceId={1}
        devices={[meta("sb-1", "Pixel 7"), meta("sb-2", "Pixel 8")]}
        onBack={vi.fn()}
      />,
    );
    // Initially the first device (sb-1) is selected — its app shows.
    expect(screen.getByText("Maps")).toBeVisible();

    // sb-1 drops from the polled device list. The stored selection is now stale;
    // the panel must reconcile to the survivor (sb-2) rather than strand on an
    // empty state for a device that no longer exists.
    rerender(
      <SandboxApps
        agentInstanceId={1}
        devices={[meta("sb-2", "Pixel 8")]}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("Edge")).toBeVisible();
    expect(screen.queryByText("Maps")).not.toBeInTheDocument();
  });
});
