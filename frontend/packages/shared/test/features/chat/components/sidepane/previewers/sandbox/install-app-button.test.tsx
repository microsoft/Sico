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
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InstallAppButton } from "@/features/chat/components/sidepane/previewers/sandbox/install-app-button";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { error: vi.fn() } };
});

const toastError = vi.mocked(toast.error);

function apkFile(name = "app.apk"): File {
  return new File(["x"], name, {
    type: "application/vnd.android.package-archive",
  });
}

beforeEach(() => {
  toastError.mockClear();
});

describe("<InstallAppButton>", () => {
  it("single device: a plain button picks the file with scope 'current'", () => {
    const onInstall = vi.fn();
    const { container } = render(
      <InstallAppButton deviceCount={1} onInstall={onInstall} />,
    );
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) {
      throw new Error("expected a file input");
    }
    fireEvent.change(input, { target: { files: [apkFile()] } });
    expect(onInstall).toHaveBeenCalledWith(expect.any(File), "current");
  });

  it("rejects a non-.apk file with an error toast and no install", () => {
    const onInstall = vi.fn();
    const { container } = render(
      <InstallAppButton deviceCount={1} onInstall={onInstall} />,
    );
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) {
      throw new Error("expected a file input");
    }
    fireEvent.change(input, { target: { files: [apkFile("notes.txt")] } });
    expect(toastError).toHaveBeenCalledWith("Please upload an .apk file.");
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("multiple devices: choosing 'all' installs with the all scope", async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const { container } = render(
      <InstallAppButton deviceCount={3} onInstall={onInstall} />,
    );
    await user.click(screen.getByRole("button", { name: "Install app" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /all android devices/i }),
    );
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) {
      throw new Error("expected a file input");
    }
    fireEvent.change(input, { target: { files: [apkFile()] } });
    expect(onInstall).toHaveBeenCalledWith(expect.any(File), "all");
  });
});
