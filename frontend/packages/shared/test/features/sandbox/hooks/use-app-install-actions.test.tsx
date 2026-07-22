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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as uploadService from "@/features/chat/services/upload";
import {
  handleInstallError,
  installErrorMessage,
  useAppInstallActions,
} from "@/features/sandbox/hooks/use-app-install-actions";
import { InstallError } from "@/features/sandbox/hooks/use-install-app";
import * as emulatorService from "@/features/sandbox/services/emulator-apps";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/chat/services/upload");
vi.mock("@/features/sandbox/services/emulator-apps");

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: {
      error: vi.fn(),
      dismiss: vi.fn(),
      loading: vi.fn(() => "loading-toast-id"),
      success: vi.fn(),
    },
  };
});

const toastError = vi.mocked(toast.error);
const toastDismiss = vi.mocked(toast.dismiss);
const toastLoading = vi.mocked(toast.loading);

beforeEach(() => {
  toastError.mockClear();
  toastDismiss.mockClear();
  toastLoading.mockClear();
});

describe("installErrorMessage", () => {
  it("gives upload-specific copy for an upload-phase failure", () => {
    const message = installErrorMessage(
      new InstallError("upload", "Upload failed"),
      "AcmeApp",
    );
    expect(message).toEqual({
      title: "Couldn't upload AcmeApp. Please try again.",
    });
  });

  it("puts a single device's reason in the title (no description)", () => {
    const message = installErrorMessage(
      new InstallError("device", "reason", [
        "Android-Device #9: INSTALL_FAILED_VERSION_DOWNGRADE",
      ]),
      "AcmeApp",
    );
    expect(message).toEqual({
      title: "Android-Device #9: INSTALL_FAILED_VERSION_DOWNGRADE",
    });
  });

  it("summarises the count in the title and moves reasons to the description for multiple devices", () => {
    const message = installErrorMessage(
      new InstallError("device", "reason", [
        "Device #9: VERSION_DOWNGRADE",
        "Device #7: INSUFFICIENT_STORAGE",
      ]),
      "AcmeApp",
    );
    expect(message).toEqual({
      title: "Couldn't install AcmeApp on 2 devices.",
      description:
        "Device #9: VERSION_DOWNGRADE; Device #7: INSUFFICIENT_STORAGE",
    });
  });

  it("falls back to a generic device message when the reasons are empty", () => {
    const message = installErrorMessage(
      new InstallError("device", "reason", []),
      "AcmeApp",
    );
    expect(message).toEqual({
      title: "AcmeApp could not be installed on the device.",
    });
  });

  it("gives the generic install message for a start-phase failure", () => {
    const message = installErrorMessage(
      new InstallError("start", "Install did not start"),
      "AcmeApp",
    );
    expect(message).toEqual({
      title: "Couldn't install AcmeApp. Please try again.",
    });
  });

  it("gives the generic install message for a non-InstallError", () => {
    const message = installErrorMessage(new Error("boom"), "AcmeApp");
    expect(message).toEqual({
      title: "Couldn't install AcmeApp. Please try again.",
    });
  });
});

describe("handleInstallError", () => {
  it("silently dismisses the loading toast on a user-driven abort", () => {
    handleInstallError(
      new InstallError("aborted", "Install cancelled"),
      "AcmeApp",
      "toast-1",
    );
    expect(toastDismiss).toHaveBeenCalledWith("toast-1");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows a device failure as an error toast carrying the reason", () => {
    handleInstallError(
      new InstallError("device", "reason", [
        "Android-Device #9: INSTALL_FAILED_VERSION_DOWNGRADE",
      ]),
      "AcmeApp",
      "toast-1",
    );
    expect(toastError).toHaveBeenCalledWith(
      "Android-Device #9: INSTALL_FAILED_VERSION_DOWNGRADE",
      { id: "toast-1", description: undefined },
    );
    expect(toastDismiss).not.toHaveBeenCalled();
  });

  it("passes the multi-device reasons through the description slot", () => {
    handleInstallError(
      new InstallError("device", "reason", [
        "Device #9: VERSION_DOWNGRADE",
        "Device #7: INSUFFICIENT_STORAGE",
      ]),
      "AcmeApp",
      "toast-1",
    );
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't install AcmeApp on 2 devices.",
      {
        id: "toast-1",
        description:
          "Device #9: VERSION_DOWNGRADE; Device #7: INSUFFICIENT_STORAGE",
      },
    );
  });
});

function makeWrapper(apiClient: AxiosInstance) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

describe("useAppInstallActions — toast lifecycle on unmount", () => {
  it("dismisses the still-pending loading toast when the panel unmounts mid-install", () => {
    // react-query gates mutate-level onSuccess/onError behind hasListeners(), so
    // on unmount they never fire and the Infinity-duration loading toast would
    // orphan. The hook's own unmount cleanup must dismiss it. Keep the install
    // in-flight with a never-resolving upload.
    vi.mocked(uploadService.uploadProjectAssetDirect).mockReturnValue(
      new Promise(() => {}),
    );
    const apiClient = {} as AxiosInstance;
    const { result, unmount } = renderHook(() => useAppInstallActions(600), {
      wrapper: makeWrapper(apiClient),
    });

    const file = new File(["x"], "app.apk", {
      type: "application/vnd.android.package-archive",
    });
    result.current.runInstall(file, "current", {
      current: "sb-1",
      all: ["sb-1"],
    });
    expect(toastLoading).toHaveBeenCalledWith("Installing app…");
    expect(toastDismiss).not.toHaveBeenCalled();

    unmount();

    expect(toastDismiss).toHaveBeenCalledWith("loading-toast-id");
  });

  it("does not dismiss a toast on StrictMode's throwaway first unmount (no install started yet)", () => {
    // StrictMode double-mounts: setup → cleanup → setup. The throwaway cleanup
    // must not fire toast.dismiss, because no install has been triggered yet and
    // the tracked-id Set is empty. Guards the ref/Set lifecycle against a
    // spurious dismiss.
    const apiClient = {} as AxiosInstance;
    renderHook(() => useAppInstallActions(600), {
      wrapper: makeWrapper(apiClient),
      reactStrictMode: true,
    });

    expect(toastDismiss).not.toHaveBeenCalled();
  });

  it("dismisses the still-pending loading toast when the panel unmounts mid-uninstall", () => {
    // runUninstall flows through the same guard/cleanup as runInstall — cover it
    // too. Keep the uninstall in-flight with a never-resolving service call.
    vi.mocked(emulatorService.uninstallEmulatorApps).mockReturnValue(
      new Promise(() => {}),
    );
    const apiClient = {} as AxiosInstance;
    const { result, unmount } = renderHook(() => useAppInstallActions(600), {
      wrapper: makeWrapper(apiClient),
    });

    const app = { appName: "AcmeApp", package: "com.acme", version: "1.0" };
    result.current.runUninstall(app, false, { current: "sb-1", all: ["sb-1"] });
    expect(toastLoading).toHaveBeenCalledWith("Uninstalling AcmeApp…");
    expect(toastDismiss).not.toHaveBeenCalled();

    unmount();

    expect(toastDismiss).toHaveBeenCalledWith("loading-toast-id");
  });
});
