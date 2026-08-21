import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { nextRefetchInterval, POLL_INTERVAL_MS } from "./next-refetch-interval";
import { assetsQueryKey } from "./use-assets-query";
import { ExtractionStatusSchema } from "../schemas/asset";
import type { AssetCategory, AssetRow, KnowledgeRow } from "../types";

// A stable fingerprint of the currently-uploading row ids — the identity of one
// extraction RUN. Same set → same run (keep accumulating toward the ceiling);
// a changed set (a new upload joins) → a new run (fresh window). Sorted so order
// never matters. Exported for unit test.
export function uploadingKey(
  rows: readonly { type: AssetRow["type"]; id: number; status?: number }[],
): string {
  return rows
    .filter(
      (row) =>
        row.type === "knowledge" &&
        row.status === ExtractionStatusSchema.enum.UPLOADED,
    )
    .map((row) => row.id)
    .sort((a, b) => a - b)
    .join(",");
}

// The uploading KNOWLEDGE rows across all loaded pages — the single filter both
// the run key and the ceiling measurement derive from (computed once per tick).
function uploadingRows(rows: readonly AssetRow[]): KnowledgeRow[] {
  return rows.filter(
    (row): row is KnowledgeRow =>
      row.type === "knowledge" &&
      row.status === ExtractionStatusSchema.enum.UPLOADED,
  );
}

type PollRun = { key: string; startedAt: number } | null;

// The list poll interval. Keyed on the uploading-id set held in `runRef`:
// no uploads → stop; a changed set → start a fresh ceiling window; otherwise
// keep measuring the current run. Mutates `runRef` (the caller's ref). Only
// knowledge (document) rows carry a pollable extraction status; playbooks /
// deliverables have none, so they never extend the window. Measured across ALL
// loaded pages (flattened) so a doc on page 2 still keeps the poll alive.
function pollInterval(
  rows: readonly AssetRow[],
  runRef: { current: PollRun },
): 5000 | false {
  const uploading = uploadingRows(rows);
  const key = uploadingKey(uploading);
  if (key === "") {
    runRef.current = null;
    return false;
  }
  if (runRef.current?.key !== key) {
    runRef.current = { key, startedAt: Date.now() };
  }
  return nextRefetchInterval(uploading, Date.now() - runRef.current.startedAt);
}

// Only the mixed `all` list and the `knowledge` list surface DOCUMENT rows, so
// only those two self-poll while an extraction is mid-flight. Deliverable /
// Experience rows carry no pollable status.
function pollsExtraction(category: AssetCategory): boolean {
  return category === "all" || category === "knowledge";
}

/**
 * Self-poll the assets list while any KNOWLEDGE document is mid-extraction.
 *
 * Split out of the query (the list is now a SUSPENSE query, which can't carry a
 * `refetchInterval` without re-suspending on every tick): instead of refetching
 * from inside the query, this hook runs a `setInterval` that `invalidateQueries`
 * the list key — which the suspense query picks up as a BACKGROUND refetch (it
 * has data, so it does NOT re-suspend → no skeleton flash).
 *
 * The interval is keyed on the uploading-id SET (`uploadingKey`): a new upload
 * changes the set → the effect re-runs → a fresh ceiling window starts (so a
 * later upload always gets its full 2-min window, the I1 regression); once every
 * row settles the key is `""` → the interval is torn down.
 */
export function useAssetsPoll(
  projectId: number,
  category: AssetCategory,
  rows: AssetRow[],
): void {
  const queryClient = useQueryClient();
  const runRef = useRef<PollRun>(null);

  // The timer reads the LIVE rows via a ref, not the captured value — outside a
  // deps array nothing re-runs the closure (react.md).
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  // Re-arm only when the uploading SET changes (not on every rows identity), so
  // unrelated re-renders don't reset the ceiling window.
  const key = uploadingKey(uploadingRows(rows));

  useEffect(() => {
    if (!pollsExtraction(category) || key === "") {
      runRef.current = null;
      return undefined;
    }
    const id = setInterval(() => {
      if (pollInterval(rowsRef.current, runRef) === false) {
        clearInterval(id);
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: assetsQueryKey(projectId, category),
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [key, category, projectId, queryClient]);
}
