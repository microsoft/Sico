import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useCallback } from "react";

import { getBoundOrganizationId } from "../services/bound-organization";

export function useOrganizationIdGetter(): () => number | null {
  const store = useStore();
  const queryClient = useQueryClient();
  return useCallback(
    () => getBoundOrganizationId(store, queryClient),
    [store, queryClient],
  );
}
