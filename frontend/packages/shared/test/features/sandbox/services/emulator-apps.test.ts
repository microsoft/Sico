import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getInstallTaskStatus,
  installEmulatorApps,
  listEmulatorApps,
  uninstallEmulatorApps,
} from "@/features/sandbox/services/emulator-apps";
import { makeOkEnvelope } from "@/schemas/api";

function makeClient(
  get: ReturnType<typeof vi.fn>,
  post: ReturnType<typeof vi.fn>,
): AxiosInstance {
  return { get, post } as unknown as AxiosInstance;
}

const get = vi.fn();
const post = vi.fn();
const apiClient = makeClient(get, post);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("listEmulatorApps", () => {
  it("POSTs the list endpoint with the user filter + instance id", async () => {
    post.mockResolvedValue({ data: makeOkEnvelope({ results: [] }) });
    await listEmulatorApps(apiClient, "413");
    expect(post).toHaveBeenCalledWith("/sandbox/emulator/apps/list", {
      appFilter: "user",
      instanceId: "413",
    });
  });

  it("unwraps the per-device results", async () => {
    post.mockResolvedValue({
      data: makeOkEnvelope({
        results: [
          {
            sandboxId: "sb-1",
            displayName: "Pixel 7",
            apps: [{ appName: "Maps", package: "com.maps", version: "1.0" }],
          },
        ],
      }),
    });
    const results = await listEmulatorApps(apiClient, "413");
    expect(results).toHaveLength(1);
    expect(results[0]?.apps[0]).toMatchObject({ package: "com.maps" });
  });

  it("drops only the malformed row, keeping valid apps on the device", async () => {
    post.mockResolvedValue({
      data: makeOkEnvelope({
        results: [
          {
            sandboxId: "sb-1",
            displayName: "Pixel 7",
            apps: [
              { appName: "Maps", package: "com.maps", version: "1.0" },
              { appName: "NoPkg", version: "1.0" },
              { appName: "Photos", package: "com.photos", version: "2.0" },
            ],
          },
        ],
      }),
    });
    const results = await listEmulatorApps(apiClient, "413");
    // Only the package-less row drops; the two valid apps survive (a single bad
    // entry must not blank the whole device list).
    expect(results[0]?.apps).toHaveLength(2);
    expect(results[0]?.apps.map((a) => a.package)).toEqual([
      "com.maps",
      "com.photos",
    ]);
  });
});

describe("installEmulatorApps", () => {
  it("POSTs install with sandbox ids + url and returns the task", async () => {
    post.mockResolvedValue({
      data: makeOkEnvelope({ status: "pending", taskId: "t-1" }),
    });
    const started = await installEmulatorApps(apiClient, {
      sandboxIds: ["sb-1"],
      url: "https://blob/app.apk",
    });
    expect(post).toHaveBeenCalledWith("/sandbox/emulator/apps/install", {
      sandboxIds: ["sb-1"],
      url: "https://blob/app.apk",
    });
    expect(started).toEqual({ status: "pending", taskId: "t-1" });
  });

  it("lowercases an upper-cased wire status", async () => {
    post.mockResolvedValue({
      data: makeOkEnvelope({ status: "PENDING", taskId: "t-1" }),
    });
    const started = await installEmulatorApps(apiClient, {
      sandboxIds: ["sb-1"],
      url: "u",
    });
    expect(started.status).toBe("pending");
  });
});

describe("getInstallTaskStatus", () => {
  it("GETs the task endpoint with an encoded id and returns the status", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({ status: "success" }) });
    const result = await getInstallTaskStatus(apiClient, "t 1");
    expect(get).toHaveBeenCalledWith("/sandbox/emulator/apps/tasks/t%201", {
      signal: undefined,
    });
    expect(result.status).toBe("success");
  });

  it("surfaces per-device adb failures from result.results[]", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        status: "error",
        result: {
          failedCount: 1,
          results: [
            {
              displayName: "Android-Device #9",
              status: "failed",
              errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
            },
          ],
        },
      }),
    });
    const result = await getInstallTaskStatus(apiClient, "t-err");
    expect(result.status).toBe("error");
    expect(result.deviceFailures).toEqual([
      {
        displayName: "Android-Device #9",
        status: "failed",
        errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
      },
    ]);
  });

  it("returns no device failures while the task is still running", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({ status: "running" }) });
    const result = await getInstallTaskStatus(apiClient, "t-run");
    expect(result.status).toBe("running");
    expect(result.deviceFailures).toEqual([]);
  });

  it("degrades to no detail when result is present but not an object", async () => {
    // The backend contract says result is an object or absent, but a shape drift
    // (e.g. an empty array) must NOT throw the poll parse — that would mask the
    // real terminal status as a generic failure. .catch(undefined) on the result
    // object keeps the status and drops the (unreadable) detail.
    get.mockResolvedValue({
      data: makeOkEnvelope({ status: "error", result: [] }),
    });
    const result = await getInstallTaskStatus(apiClient, "t-drift");
    expect(result.status).toBe("error");
    expect(result.deviceFailures).toEqual([]);
  });

  it("keeps the valid device reasons when one sibling row is malformed", async () => {
    // One bad element must not collapse the whole array — the per-element
    // .nullable().catch(null) + filter drops only the malformed row.
    get.mockResolvedValue({
      data: makeOkEnvelope({
        status: "error",
        result: {
          results: [
            {
              displayName: "Android-Device #9",
              status: "failed",
              errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
            },
            "not-a-device-row",
          ],
        },
      }),
    });
    const result = await getInstallTaskStatus(apiClient, "t-mixed");
    expect(result.deviceFailures).toEqual([
      {
        displayName: "Android-Device #9",
        status: "failed",
        errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
      },
    ]);
  });

  it("keeps only the non-success rows when a task has mixed device outcomes", async () => {
    // A task can settle with some devices installed and others failed. Only the
    // failed rows become deviceFailures — a succeeded device must not surface a
    // (non-existent) reason to the toast.
    get.mockResolvedValue({
      data: makeOkEnvelope({
        status: "error",
        result: {
          results: [
            { displayName: "Pixel 7", status: "success", errorMessage: "" },
            {
              displayName: "Android-Device #9",
              status: "failed",
              errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
            },
          ],
        },
      }),
    });
    const result = await getInstallTaskStatus(apiClient, "t-partial");
    expect(result.deviceFailures).toEqual([
      {
        displayName: "Android-Device #9",
        status: "failed",
        errorMessage: "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]",
      },
    ]);
  });
});

describe("uninstallEmulatorApps", () => {
  it("POSTs uninstall with the package + sandbox ids", async () => {
    post.mockResolvedValue({
      data: makeOkEnvelope({ status: "success", results: [] }),
    });
    await uninstallEmulatorApps(apiClient, {
      package: "com.maps",
      sandboxIds: ["sb-1", "sb-2"],
    });
    expect(post).toHaveBeenCalledWith("/sandbox/emulator/apps/uninstall", {
      package: "com.maps",
      sandboxIds: ["sb-1", "sb-2"],
    });
  });

  it("returns the per-device results for partial-success reporting", async () => {
    post.mockResolvedValue({
      data: makeOkEnvelope({
        status: "partial",
        results: [
          { sandboxId: "sb-1", displayName: "Pixel 7", status: "uninstalled" },
          { sandboxId: "sb-2", displayName: "Pixel 8", status: "failed" },
        ],
      }),
    });
    const result = await uninstallEmulatorApps(apiClient, {
      package: "com.maps",
      sandboxIds: ["sb-1", "sb-2"],
    });
    expect(result.status).toBe("partial");
    expect(result.results).toHaveLength(2);
  });
});
