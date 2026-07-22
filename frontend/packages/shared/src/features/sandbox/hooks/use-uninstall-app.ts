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
