import { useSuspenseQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { userAtom } from "../../../atoms/auth-atom";
import { useApiClient } from "../../../services/api-client-context";
import {
  deriveCapabilities,
  type ProjectCapabilities,
  projectRoleFor,
  userRolesQueryOptions,
} from "../capabilities";

export type ProjectPermissionSuspense = ProjectCapabilities & {
  /** The current user's email — used for per-row `.own` checks. */
  userEmail: string | null;
};

// Suspense variant of `useProjectPermission` — returns the capability set (+ the
// user's email) with loading/error owned by the caller's Suspense +
// ErrorBoundary instead of flags. Used inside the project drawer's sections so
// permission is "part of the request". Shares the non-suspense hook's cache
// entry via `userRolesQueryOptions`; before the user atom hydrates it resolves
// to no capabilities under a separate `null` key rather than fetching "user 0".
export function useProjectPermissionSuspense(
  projectId: number,
): ProjectPermissionSuspense {
  const apiClient = useApiClient();
  const user = useAtomValue(userAtom);

  const { data } = useSuspenseQuery(
    userRolesQueryOptions(apiClient, user?.id ?? null),
  );

  const capabilities = deriveCapabilities(projectRoleFor(data, projectId));
  return { ...capabilities, userEmail: user?.email ?? null };
}
