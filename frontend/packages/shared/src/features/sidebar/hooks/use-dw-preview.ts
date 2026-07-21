import { useMemo } from "react";

import { useAgentsQuery } from "../../digital-worker/hooks/use-agents-query";
import type { Agent } from "../../digital-worker/schemas/agent";
import { DW_PREVIEW } from "../constants";

// Subset of Agent needed for sidebar rows. Defined here (not on a row
// component) because both DwList and RailDwList consume the same shape
// through useDwPreview().
export type AgentLite = Pick<Agent, "id" | "name" | "role" | "iconUri">;

export type DwPreviewState =
  | { readonly status: "pending" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly items: readonly AgentLite[] };

const PENDING: DwPreviewState = { status: "pending" };
const ERROR: DwPreviewState = { status: "error" };

/**
 * Sidebar DW preview selector. Single source of truth for "first page,
 * capped at DW_PREVIEW" — consumed by both DwList (expanded) and
 * RailDwList (collapsed) so skeleton/empty/error/ready branching stays
 * in sync. Empty arrays surface as `status: "ready"` with `items: []` —
 * consumers branch on `items.length` to pick their empty UI. Result is
 * memoised so downstream React.memo on row lists isn't blown by a fresh
 * object/array identity on every parent render.
 */
export function useDwPreview(): DwPreviewState {
  const query = useAgentsQuery();
  const firstPage = query.data?.pages[0]?.items;
  return useMemo<DwPreviewState>(() => {
    if (query.isError) {
      return ERROR;
    }
    if (query.isPending) {
      return PENDING;
    }
    return {
      status: "ready",
      items: (firstPage ?? []).slice(0, DW_PREVIEW),
    };
  }, [query.isError, query.isPending, firstPage]);
}
