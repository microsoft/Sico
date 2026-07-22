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

import { AppsTable } from "@/features/chat/components/sidepane/previewers/sandbox/apps-table";
import { type EmulatorApp } from "@/features/sandbox/schemas/emulator-app";

function app(overrides: Partial<EmulatorApp> = {}): EmulatorApp {
  return { appName: "Maps", package: "com.maps", version: "1.0", ...overrides };
}

describe("<AppsTable>", () => {
  it("renders a row per app with its name and version", () => {
    render(
      <AppsTable
        apps={[
          app(),
          app({ appName: "Mail", package: "com.mail", version: "2.3" }),
        ]}
        hasMultipleDevices={false}
        onUninstall={vi.fn()}
      />,
    );
    expect(screen.getByText("Maps")).toBeVisible();
    expect(screen.getByText("2.3")).toBeVisible();
  });

  it("shows the brand app-icon tile beside each row name", () => {
    render(
      <AppsTable
        apps={[app()]}
        hasMultipleDevices={false}
        onUninstall={vi.fn()}
      />,
    );
    // Legacy parity: the name cell leads with the purple app-icon illustration
    // (a bitmap asset inlined by the bundler, not a lucide glyph). Assert the
    // src is an SVG carrying the legacy brand fill (#BDBFFF) so a swap to a
    // different asset is caught.
    const src = screen.getByTestId("app-icon").getAttribute("src") ?? "";
    expect(src).toMatch(/^data:image\/svg\+xml/);
    expect(src.toUpperCase()).toContain("BDBFFF");
  });

  it("does not apply a hover highlight to the header row", () => {
    render(
      <AppsTable
        apps={[app()]}
        hasMultipleDevices={false}
        onUninstall={vi.fn()}
      />,
    );
    // The header row must not react to hover. TableRow scopes its highlight to
    // `[tbody_&]:hover:bg-primary-50`, so a row inside <thead> never triggers
    // it — no header-level neutralizing class is needed.
    const headerRow = screen
      .getByRole("columnheader", { name: "Name" })
      .closest('[data-slot="table-row"]');
    expect(headerRow).toHaveClass("[tbody_&]:hover:bg-primary-50");
    expect(headerRow).not.toHaveClass("hover:bg-primary-50");
  });

  it("shows an empty message when there are no apps", () => {
    render(
      <AppsTable apps={[]} hasMultipleDevices={false} onUninstall={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "No apps installed" }),
    ).toBeVisible();
  });

  it("single device: the row menu offers Uninstall but not 'for all'", async () => {
    const user = userEvent.setup();
    const onUninstall = vi.fn();
    render(
      <AppsTable
        apps={[app()]}
        hasMultipleDevices={false}
        onUninstall={onUninstall}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Maps" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Uninstall" }),
    );
    expect(onUninstall).toHaveBeenCalledWith(
      expect.objectContaining({ package: "com.maps" }),
      false,
    );
  });

  it("multiple devices: 'Uninstall for all devices' uninstalls with forAll=true", async () => {
    const user = userEvent.setup();
    const onUninstall = vi.fn();
    render(
      <AppsTable apps={[app()]} hasMultipleDevices onUninstall={onUninstall} />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for Maps" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Uninstall for all devices",
      }),
    );
    expect(onUninstall).toHaveBeenCalledWith(
      expect.objectContaining({ package: "com.maps" }),
      true,
    );
  });
});
