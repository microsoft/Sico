import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import * as uploadService from "@/features/chat/services/upload";
import {
  InstallError,
  runInstallFlow,
} from "@/features/sandbox/hooks/use-install-app";
import * as emulatorService from "@/features/sandbox/services/emulator-apps";

vi.mock("@/features/chat/services/upload");
vi.mock("@/features/sandbox/services/emulator-apps");

const apiClient = {} as AxiosInstance;

function apkFile(): File {
  return new File(["x"], "app.apk", {
    type: "application/vnd.android.package-archive",
  });
}

const vars = { file: apkFile(), sandboxIds: ["sb-1"] };

beforeEach(() => {
  vi.mocked(uploadService.uploadProjectAssetDirect).mockReset();
  vi.mocked(emulatorService.installEmulatorApps).mockReset();
  vi.mocked(emulatorService.getInstallTaskStatus).mockReset();

  vi.mocked(uploadService.uploadProjectAssetDirect).mockResolvedValue({
    name: "app.apk",
    size: 1,
    type: "application/vnd.android.package-archive",
    uri: "asset://app.apk",
    sasUrl: "https://blob/app.apk",
  });
  vi.mocked(emulatorService.installEmulatorApps).mockResolvedValue({
    status: "pending",
    taskId: "t-1",
  });
});

describe("runInstallFlow — abort classification", () => {
  it("classifies an abort that lands WHILE the poll GET is in flight as an 'aborted' InstallError", async () => {
    // The axios interceptor turns a cancelled in-flight request into a synthetic
    // network envelope, so getInstallTaskStatus rejects with a plain ZodError,
    // NOT a recognisable cancel. runInstallFlow must re-check signal.aborted in
    // the catch and report it as an 'aborted' phase so the caller dismisses the
    // toast silently instead of showing "Couldn't install".
    const controller = new AbortController();
    vi.mocked(emulatorService.getInstallTaskStatus).mockImplementation(
      async () => {
        controller.abort();
        throw new ZodError([]);
      },
    );

    const error = await runInstallFlow(
      apiClient,
      vars,
      controller.signal,
    ).catch((e: unknown) => e);

    // Assert both facets of the ONE catch-path this test targets: it's a tagged
    // InstallError and the tag is 'aborted'. (Reusing the aborted controller for
    // a second call would short-circuit at the top-of-loop guard, testing a
    // different path — so drive it exactly once.)
    expect(error).toBeInstanceOf(InstallError);
    expect(error).toMatchObject({ phase: "aborted" });
  });

  it("rethrows a genuine poll failure (signal NOT aborted) as-is, not wrapped as an abort", async () => {
    // A rejecting GET with the signal still live is a real failure. runInstallFlow
    // doesn't wrap poll errors, so the raw ZodError propagates unchanged — it is
    // NOT an InstallError, so the caller's handleInstallError falls through to the
    // generic toast (which is the intended behaviour for an unexpected failure).
    const controller = new AbortController();
    vi.mocked(emulatorService.getInstallTaskStatus).mockRejectedValue(
      new ZodError([]),
    );

    const error = await runInstallFlow(
      apiClient,
      vars,
      controller.signal,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ZodError);
    expect(error).not.toBeInstanceOf(InstallError);
  });

  it("throws a 'device' InstallError with the per-device reasons on a terminal error status", async () => {
    const controller = new AbortController();
    vi.mocked(emulatorService.getInstallTaskStatus).mockResolvedValue({
      status: "error",
      deviceFailures: [
        {
          displayName: "Android-Device #9",
          status: "failed",
          errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
        },
      ],
    });

    await expect(
      runInstallFlow(apiClient, vars, controller.signal),
    ).rejects.toMatchObject({
      phase: "device",
      deviceReasons: [
        "Android-Device #9: Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
      ],
    });
  });

  it("falls back to 'Device: install failed' when a failing row carries no name or reason", async () => {
    // The lenient schema can yield a failing device row with empty displayName
    // and errorMessage. The reason string must still name a device and a cause,
    // never render as a bare ": ".
    const controller = new AbortController();
    vi.mocked(emulatorService.getInstallTaskStatus).mockResolvedValue({
      status: "error",
      deviceFailures: [
        { displayName: "", status: "failed", errorMessage: "  " },
      ],
    });

    await expect(
      runInstallFlow(apiClient, vars, controller.signal),
    ).rejects.toMatchObject({
      phase: "device",
      deviceReasons: ["Device: install failed"],
    });
  });
});
