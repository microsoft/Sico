import { ExtractionStatusSchema } from "../schemas/asset";

// Poll interval for the assets table's extraction-status refresh. PURE — no
// timers, no clock reads; the caller measures elapsed time and react-query owns
// the clock. We keep polling at 5s while any KNOWLEDGE row is still UPLOADED
// (mid-extraction); we stop (return `false`) once every row is settled —
// INGESTED (≥3) or FAILED (1) — or once a single poll RUN has been going for
// 2 minutes (a wall-clock ceiling, NOT an update count: a cumulative tick count
// is eroded by every CRUD-driven cache invalidation, so a later upload could be
// denied its full polling window), or when there are no rows. Experience rows
// carry no `status`, so they read as already-settled.
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_DURATION_MS = 120_000;
const { UPLOADED } = ExtractionStatusSchema.enum;

// Exported so `useAssetsPoll` drives its `setInterval` on the same cadence.
export { POLL_INTERVAL_MS };

export function nextRefetchInterval(
  rows: readonly { status?: number }[],
  elapsedMs: number,
): 5000 | false {
  if (rows.length === 0 || elapsedMs >= MAX_POLL_DURATION_MS) {
    return false;
  }
  const anyUploading = rows.some((row) => row.status === UPLOADED);
  return anyUploading ? POLL_INTERVAL_MS : false;
}
