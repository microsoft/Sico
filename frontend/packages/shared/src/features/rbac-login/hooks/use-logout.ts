// Orchestrates server logout → client cleanup → navigate. Server failure
// is non-blocking: client cleanup + navigate still run via `onSettled`.
import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { logoutAtom } from "../../../atoms/auth-atom";
import { useApiClient } from "../../../services/api-client-context";
import { logoutApi } from "../services/logout-api";

export function useLogout(): UseMutationResult<void, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const logout = useSetAtom(logoutAtom);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => logoutApi(apiClient),
    onSettled: async () => {
      // Navigate first so Sidebar/useAgentsQuery unmount before auth +
      // cache are wiped — otherwise the still-mounted query refetches
      // against a cleared token → spurious 401 flash. try/finally so
      // client cleanup runs even if navigation throws.
      try {
        await navigate({ to: "/login", replace: true });
      } finally {
        logout();
        queryClient.clear();
      }
    },
  });
}
