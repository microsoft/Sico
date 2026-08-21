import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { projectDevicesQueryKey } from "./use-project-devices-query";
import { useApiClient } from "../../../services/api-client-context";
import { assignDevice, type AssignDeviceInput } from "../services/devices";

// Bind a device to a Digital Worker instance, then invalidate the project's
// device list (the sandbox PAGE) AND the project detail (the DRAWER reads its
// sandbox count from `project.sandboxes`) so both refresh immediately. The
// detail key is inlined rather than imported from `projects/` to keep this
// feature from depending on that one (the dependency runs the other way).
export function useAssignDeviceMutation(
  projectId: number,
): UseMutationResult<void, Error, AssignDeviceInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignDeviceInput) => assignDevice(apiClient, input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: projectDevicesQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", "detail", projectId],
        }),
      ]),
  });
}
