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
