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

import { type AxiosInstance } from "axios";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import {
  APP_INSTALL_TASK_STATUS,
  type EmulatorAppsDeviceResult,
  type InstallDeviceResult,
  installEmulatorAppsDataSchema,
  installTaskStatusDataSchema,
  listEmulatorAppsDataSchema,
  type UninstallDeviceResult,
  uninstallEmulatorAppsDataSchema,
} from "../schemas/emulator-app";

// Emulator app management against the dwp sandbox backend (same proxied origin
// as `/sandbox/instance`). Each fn parses the standard `{code,msg,data}`
// envelope and rejects a non-OK code before reading `data` (via `unwrapData`).

const LIST_PATH = "/sandbox/emulator/apps/list";
const INSTALL_PATH = "/sandbox/emulator/apps/install";
const UNINSTALL_PATH = "/sandbox/emulator/apps/uninstall";
const TASK_PATH = "/sandbox/emulator/apps/tasks";

// User-installed apps per device for an agent instance. `appFilter: "user"`
// excludes system apps (legacy parity).
export async function listEmulatorApps(
  apiClient: AxiosInstance,
  instanceId: string,
): Promise<EmulatorAppsDeviceResult[]> {
  const response = await apiClient.post<unknown>(LIST_PATH, {
    appFilter: "user",
    instanceId,
  });
  const parsed = apiResponseSchema(listEmulatorAppsDataSchema).parse(
    response.data,
  );
  return unwrapData(parsed, "listEmulatorApps").results;
}

export type InstallStarted = {
  status: string;
  taskId: string;
};

// Kick off an install of an already-uploaded apk (its `sasUrl`) onto the given
// devices. Returns the pending task to poll; the caller checks `status` is
// `pending` + a non-empty `taskId` before polling.
export async function installEmulatorApps(
  apiClient: AxiosInstance,
  params: { sandboxIds: string[]; url: string },
): Promise<InstallStarted> {
  const response = await apiClient.post<unknown>(INSTALL_PATH, params);
  const parsed = apiResponseSchema(installEmulatorAppsDataSchema).parse(
    response.data,
  );
  return unwrapData(parsed, "installEmulatorApps");
}

export type InstallTaskStatus = {
  status: string;
  // Per-device failures from a terminal task, carrying the raw adb reason for
  // the failure toast. Empty while pending/running or when the backend omits
  // the detail.
  deviceFailures: InstallDeviceResult[];
};

// Poll one install task's status. Terminal: `success` / `error`. `pending` /
// `running` / `partial` keep polling — for an install, `partial` is a transient
// "some devices done, others still going" state the backend settles into
// `success`/`error` (legacy dwp treats it the same way; the poll loop owns this
// classification). On a terminal failure the backend's `result.results[]`
// carries the per-device adb error, surfaced here so the caller can show WHY it
// failed instead of a generic message.
export async function getInstallTaskStatus(
  apiClient: AxiosInstance,
  taskId: string,
  signal?: AbortSignal,
): Promise<InstallTaskStatus> {
  const response = await apiClient.get<unknown>(
    `${TASK_PATH}/${encodeURIComponent(taskId)}`,
    { signal },
  );
  const parsed = apiResponseSchema(installTaskStatusDataSchema).parse(
    response.data,
  );
  const data = unwrapData(parsed, "getInstallTaskStatus");
  return {
    status: data.status,
    deviceFailures: (data.result?.results ?? []).filter(
      (r) => r.status !== APP_INSTALL_TASK_STATUS.success,
    ),
  };
}

export type UninstallResult = {
  status: string;
  results: UninstallDeviceResult[];
};

// Uninstall one app (by `package`) from the given devices. `results` names the
// per-device outcome so the caller can report which devices an "all" uninstall
// couldn't clear.
export async function uninstallEmulatorApps(
  apiClient: AxiosInstance,
  params: { package: string; sandboxIds: string[] },
): Promise<UninstallResult> {
  const response = await apiClient.post<unknown>(UNINSTALL_PATH, params);
  const parsed = apiResponseSchema(uninstallEmulatorAppsDataSchema).parse(
    response.data,
  );
  return unwrapData(parsed, "uninstallEmulatorApps");
}
