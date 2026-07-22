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

import {
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type EmulatorAppsDeviceResult } from "../schemas/emulator-app";
import { listEmulatorApps } from "../services/emulator-apps";

// User-installed apps per device for an agent instance. Unlike the device list
// (`useSandboxInstancesQuery`), this does NOT poll: the app set only changes on
// an explicit install/uninstall, which invalidate this query themselves. The
// key is the agent instance (the list endpoint keys off it); consumers filter
// to the device tab they're viewing.
export function emulatorAppsQueryKey(
  instanceId: number,
): readonly ["sandbox", "emulator-apps", number] {
  return ["sandbox", "emulator-apps", instanceId] as const;
}

export function emulatorAppsQueryOptions(
  instanceId: number,
  apiClient: AxiosInstance,
): {
  queryKey: readonly ["sandbox", "emulator-apps", number];
  queryFn: () => Promise<EmulatorAppsDeviceResult[]>;
} {
  return {
    queryKey: emulatorAppsQueryKey(instanceId),
    queryFn: (): Promise<EmulatorAppsDeviceResult[]> =>
      listEmulatorApps(apiClient, String(instanceId)),
  };
}

export function useEmulatorAppsQuery(
  instanceId: number,
): UseSuspenseQueryResult<EmulatorAppsDeviceResult[]> {
  const apiClient = useApiClient();
  return useSuspenseQuery(emulatorAppsQueryOptions(instanceId, apiClient));
}
