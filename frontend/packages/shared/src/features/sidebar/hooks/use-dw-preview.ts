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
