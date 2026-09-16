import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { userAtom } from "../../../atoms/auth-atom";
import { useApiClient } from "../../../services/api-client-context";
import { organizationKeys } from "../query-keys";
import {
  type OrganizationUpdate,
  updateOrganization,
} from "../services/organization";

export function useUpdateOrganization(
  organizationId: number,
): UseMutationResult<void, Error, OrganizationUpdate> {
  const apiClient = useApiClient();
  const userId = useAtomValue(userAtom)?.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values) =>
      updateOrganization(apiClient, organizationId, values),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: organizationKeys.userOrganizations(userId),
          exact: true,
        }),
      ]),
  });
}
