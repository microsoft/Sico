import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import { type Sandbox, SANDBOX_VISIBLE_STATUSES } from "../schemas/sandbox";
import { fetchSandboxInstances } from "../services/sandbox";

const POLL_INTERVAL_MS = 5000;

// Keep only live, showable devices, then sort for a STABLE display order: by
// `displayName` (numeric-aware) then `sandboxId` as a tie-break. The backend
// does not guarantee order across polls — without this the device list jumps
// around every 5 s as the scheduler reshuffles. Applied in `select` so the
// transform runs off the cached payload, not inside every consumer.
//
// Status is matched case-insensitively (the list is lowercase) so the filter
// agrees with `SandboxStatus`, which keys its badge off `status.toLowerCase()` —
// otherwise an oddly-cased wire status would drop the device from the list here
// while still mapping to a badge there.
function visibleSorted(items: Sandbox[]): Sandbox[] {
  return items
    .filter((s) => SANDBOX_VISIBLE_STATUSES.includes(s.status.toLowerCase()))
    .sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName, undefined, {
        numeric: true,
      });
      return byName !== 0 ? byName : a.sandboxId.localeCompare(b.sandboxId);
    });
}

export function sandboxInstancesQueryOptions(
  agentInstanceId: number,
  apiClient: AxiosInstance,
): {
  queryKey: readonly ["sandbox", "instances", number];
  queryFn: () => Promise<Sandbox[]>;
  select: (items: Sandbox[]) => Sandbox[];
  refetchInterval: number;
  refetchIntervalInBackground: boolean;
} {
  return {
    queryKey: ["sandbox", "instances", agentInstanceId] as const,
    queryFn: (): Promise<Sandbox[]> =>
      fetchSandboxInstances(apiClient, agentInstanceId),
    select: visibleSorted,
    // 5 s background poll; paused while the tab is hidden so a backgrounded
    // sidepane stops hammering the backend (legacy gated the interval on
    // `document.visibilityState`).
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  };
}

// The sandbox previewer reads the live device list and drives its own
// list/instance view from it. A non-suspense query: the previewer renders its
// own loading + error states (MI16/MI17) rather than suspending the sidepane.
export function useSandboxInstancesQuery(
  agentInstanceId: number,
): UseQueryResult<Sandbox[]> {
  const apiClient = useApiClient();
  return useQuery(sandboxInstancesQueryOptions(agentInstanceId, apiClient));
}
