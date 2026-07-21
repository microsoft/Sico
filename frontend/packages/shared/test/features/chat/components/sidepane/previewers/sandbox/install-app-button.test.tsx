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
