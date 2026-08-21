import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { userAtom } from "../../../atoms/auth-atom";
import { useApiClient } from "../../../services/api-client-context";
import {
  deriveCapabilities,
  type ProjectCapabilities,
  projectRoleFor,
  userRolesQueryOptions,
} from "../capabilities";

export type ProjectPermission = ProjectCapabilities & {
  /** The current user's email — the identity used for per-row `.own` checks
   * (the User schema has no username). Null until the user atom hydrates. */
  userEmail: string | null;
  isLoading: boolean;
  /** True when the roles fetch failed. The derived capabilities are all `false`
   * in that case, so consumers gating on `!isLoading && capability` hide their
   * controls — a deliberate FAIL-CLOSED default (the backend re-authorizes every
   * mutation regardless). Surfaced so a caller can additionally show a retry. */
  isError: boolean;
};

// The current user's project capabilities. Reads the user's full role list once
// (cached under a user-scoped key so multiple components share one fetch — see
// `userRolesQueryOptions`), derives the project role, and maps it to capability
// booleans. Consumers gate on `!isLoading && capability` so controls stay hidden
// until the query settles (avoids a hidden→shown flash) and stay hidden on error
// (fail closed).
export function useProjectPermission(projectId: number): ProjectPermission {
  const apiClient = useApiClient();
  const user = useAtomValue(userAtom);

  // A `null` id (user atom not hydrated) resolves to no roles without a network
  // call, so no `enabled` guard is needed — see `userRolesQueryOptions`.
  const { data, isLoading, isError } = useQuery(
    userRolesQueryOptions(apiClient, user?.id ?? null),
  );

  const role = projectRoleFor(data ?? [], projectId);
  const capabilities = deriveCapabilities(role);

  return {
    ...capabilities,
    userEmail: user?.email ?? null,
    isLoading,
    isError,
  };
}
