import {
  useQuery,
  type UseQueryResult,
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type Device } from "../schemas/device";
import { fetchDevices } from "../services/devices";

// Query key for a project's sandbox device list. Scoped by project so switching
// projects doesn't show a stale list, and so the assign mutation can invalidate
// exactly this entry.
export function projectDevicesQueryKey(
  projectId: number,
): readonly ["sandbox-devices", "list", number] {
  return ["sandbox-devices", "list", projectId] as const;
}

export function projectDevicesQueryOptions(
  projectId: number,
  apiClient: AxiosInstance,
): {
  queryKey: ReturnType<typeof projectDevicesQueryKey>;
  queryFn: () => Promise<Device[]>;
} {
  return {
    queryKey: projectDevicesQueryKey(projectId),
    // `GET /sandbox/list?projectId` is project-scoped by the backend: a sandbox
    // must be org→project assigned before it can be bound to a DW, so this only
    // returns the sandboxes bound to THIS project. Keyed by `projectId` so
    // switching projects gets a fresh entry the assign mutation invalidates.
    queryFn: (): Promise<Device[]> => fetchDevices(apiClient, projectId),
  };
}

export function useProjectDevicesQuery(
  projectId: number,
): UseQueryResult<Device[]> {
  const apiClient = useApiClient();
  return useQuery(projectDevicesQueryOptions(projectId, apiClient));
}

// Suspense variant — used where the caller wraps this in a Suspense boundary
// (e.g. the project drawer's Sandbox section), so loading/error are owned by
// that boundary rather than a `isPending`/`isError` flag. Shares the same query
// key + options, mirroring `useProjectMembersSuspenseQuery`.
export function useProjectDevicesSuspenseQuery(
  projectId: number,
): UseSuspenseQueryResult<Device[]> {
  const apiClient = useApiClient();
  return useSuspenseQuery(projectDevicesQueryOptions(projectId, apiClient));
}
