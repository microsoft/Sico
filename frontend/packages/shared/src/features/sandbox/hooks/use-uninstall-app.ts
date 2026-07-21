import { useMutation, useQueryClient } from "@tanstack/react-query";

import { emulatorAppsQueryKey } from "./use-emulator-apps-query";
import { useApiClient } from "../../../services/api-client-context";
import { APP_OP_STATUS } from "../schemas/emulator-app";
import { uninstallEmulatorApps } from "../services/emulator-apps";

const UNINSTALLED = "uninstalled";

type UninstallVars = {
  package: string;
  sandboxIds: string[];
};

// The devices an "uninstall from all" couldn't clear, so the caller can name
// them in a partial-success message. Empty when every device succeeded.
export type UninstallOutcome = {
  failedDeviceNames: string[];
};

// Uninstall one app (by package) from the given devices. Resolves with the
// devices that didn't clear (for the partial-success toast) or throws on an
// overall failure. Success invalidates the apps query to refresh the list.
export function useUninstallApp(
  instanceId: number,
): ReturnType<typeof useMutation<UninstallOutcome, Error, UninstallVars>> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<UninstallOutcome, Error, UninstallVars>({
    mutationFn: async (vars: UninstallVars): Promise<UninstallOutcome> => {
      const result = await uninstallEmulatorApps(apiClient, vars);
      if (
        result.status !== APP_OP_STATUS.success &&
        result.status !== APP_OP_STATUS.partial
      ) {
        throw new Error("Uninstall failed");
      }
      const failedDeviceNames = result.results
        .filter((r) => r.status !== UNINSTALLED)
        .map((r) => r.displayName)
        .filter((name) => name.length > 0);
      return { failedDeviceNames };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: emulatorAppsQueryKey(instanceId),
      });
    },
  });
}
