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

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { ArrowDown, ArrowUp, Info, type LucideIcon, X } from "lucide-react";
import type * as React from "react";

import { type AssetActionKind, AssetRow } from "./asset-row";
import { renderRowDialogs } from "./asset-row-actions";
import { renderAssetSkeletonCells } from "./asset-row-skeleton";
import { AssetsEmpty } from "./assets-empty";
import {
  CREATOR_MAX,
  PIN_HEAD_LEFT,
  PIN_HEAD_RIGHT,
  PIN_RIGHT,
} from "./pinned-columns";
import { useAssetRowActions } from "../hooks/use-asset-row-actions";
import { useAssetsPoll } from "../hooks/use-assets-poll";
import { useSuspenseAssetsInfiniteQuery } from "../hooks/use-assets-query";
import {
  HINT_COPY,
  type HintTab,
  resolveHintTab,
  useDismissedHints,
} from "../hooks/use-dismissed-hints";
import { useExtractionResultToast } from "../hooks/use-extraction-toasts";
import { useTableScrollEdges } from "../hooks/use-table-scroll-edges";
import type { AssetSearch } from "../schemas/asset-search";
import type { AssetCategory, AssetRow as AssetRowData } from "../types";

export type AssetsTableRowsProps = {
  projectId: number;
  category: AssetCategory;
  search: AssetSearch;
  onSearchChange: (next: Partial<AssetSearch>) => void;
  /**
   * Append content-shaped skeleton rows to the table body while the
   * infinite-scroll pager loads the next page (mirrors the cold-load skeleton
   * row shape). Owned by `AssetsTable` (which holds the pager); passed in so
   * the placeholder rows live inside the SAME `<TableBody>` as the real rows,
   * keeping column widths aligned and the table from reflowing on resolve.
   */
  isFetchingNextPage?: boolean;
};

// How many skeleton rows to append while the next page loads. Matches a
// typical page size visually without dominating the viewport.
const LOADING_MORE_ROW_COUNT = 3;

// CREATED TIME renders separately as a sort toggle, so it is excluded here.
const PLAIN_HEADERS = ["ASSET NAME", "TYPE", "CREATOR"] as const;

// Full column span for the in-table hint bar: the plain headers + CREATED TIME +
// ACTIONS. Derived so it can't drift from the header row.
const COLUMN_COUNT = PLAIN_HEADERS.length + 2;

// Centering wrapper for the empty state — the surrounding `bg-surface-basic …
// rounded-2xl` scroll card is the persistent shell in `AssetsTable`, so this is
// centering-only (no surface/shadow/radius).
const CENTER = "flex min-h-0 flex-1 items-center justify-center";

// Empty-state override: the scroll card injects `flex-1` onto EVERY descendant
// table-container (`**:data-[slot=table-container]:flex-1`). With rows that's
// right — the table fills and scrolls. But when the only body content is the
// hint row and the empty state renders below, that `flex-1` makes the header+hint
// table share the column's height 50/50 with `CENTER` (also `flex-1`), pushing
// the empty state into the lower half instead of centering it in the card. Added
// to the `contents` table wrapper (which adds no box of its own) only when empty,
// so the table shrinks to its content and `CENTER` takes the rest. Scoped to the
// container (Table's own `className` lands on the inner <table>).
const EMPTY_TABLE = "[&_[data-slot=table-container]]:flex-none";

// Free-text filter + createdAt sort applied to the ALREADY-LOADED rows. The
// category split now lives in the route (one endpoint per path), so there is no
// tab filter here. NOTE (§ pagination): search/sort act only on loaded pages —
// correct for small lists (the common case); a backend `keyword`/`sort` param
// would be needed to filter/sort across unfetched pages (follow-up). Because the
// infinite-scroll sentinel stays mounted even when a search hides every loaded
// row (empty state), the observer keeps pulling further pages while `hasNextPage`
// — so a match on a not-yet-loaded page is still reached by scrolling, rather
// than the search stalling on page 1.
//
// FOLLOW-UP (sico-review I-B): the flip side of that auto-load is that a search
// matching NOTHING walks the sentinel through every remaining page — i.e. a
// no-match query on a large list fires a burst of sequential fetches until
// `hasNextPage` clears. It terminates and is harmless on the small lists this
// release targets, but the real fix is the backend `keyword` param above (so the
// server returns only matches); short of that a page-count cap or an explicit
// "Load more" affordance would bound it. Tracked, not addressed here.
function selectVisibleRows(
  rows: AssetRowData[],
  search: AssetSearch,
): AssetRowData[] {
  const query = search.q.trim().toLowerCase();
  const byQuery = query
    ? rows.filter((row) => row.name.toLowerCase().includes(query))
    : rows;
  return [...byQuery].sort((a, b) =>
    search.sort === "asc"
      ? a.createdAt - b.createdAt
      : b.createdAt - a.createdAt,
  );
}

// The full-width definition-hint bar (Figma `message bar`), rendered as the
// first body row under the column headers: a leading Info glyph + bold label +
// regular description + a dismiss button. Only the two derived tabs reach here
// (resolveHintTab gates it). Plain helper (no hooks) so `renderAssetsTable`
// stays under the line ceiling.
function renderHintRow(
  hintTab: HintTab,
  onDismissHint: (tab: HintTab) => void,
): React.JSX.Element {
  const { label, description } = HINT_COPY[hintTab];
  return (
    // The sunken tint lives on the ROW (an opaque resting fill), so the
    // pinned dismiss cell — whose `PIN_RIGHT` carries `bg-inherit` — adopts the
    // same fill as the content cell instead of falling through to the table's
    // white and reading half-grey at rest. `hover:bg-surface-sunken` cancels
    // TableRow's built-in `hover:bg-primary-50`: the hint is non-interactive, so
    // it must not react to hover.
    <TableRow className="bg-surface-sunken hover:bg-surface-sunken h-11">
      <TableCell
        colSpan={COLUMN_COUNT - 1}
        className="h-11 max-w-none bg-inherit px-6"
      >
        <div className="flex items-center gap-2 text-sm">
          <Info className="text-icon-secondary size-4 shrink-0" />
          <p className="text-foreground-secondary flex-1">
            <span className="text-foreground-primary font-medium">{label}</span>{" "}
            {description}
          </p>
        </div>
      </TableCell>
      {/* The dismiss lives in its OWN cell pinned to the ACTIONS column (same
          `PIN_RIGHT` as the row menu), so × lines up with the per-row ··· and
          stays visible when the table scrolls horizontally instead of floating
          off the right edge of a full-span cell. */}
      <TableCell className={cn("h-11 px-2 text-right", PIN_RIGHT)}>
        <Button
          variant="subtle"
          size="icon-xs"
          aria-label="Don't show again"
          onClick={() => onDismissHint(hintTab)}
        >
          <X />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// Content-shaped placeholder row mirroring the 5-column AssetRow layout. Shares
// its cells with `AssetsTableSkeleton`'s cold-load row via `renderAssetSkeletonCells`
// so the loading-more affordance reads as part of the same table; only the row
// shell (key, aria-hidden, test id) differs.
function renderLoadingMoreRow(key: number): React.JSX.Element {
  return (
    <TableRow
      key={`loading-more-${key}`}
      aria-hidden="true"
      className="bg-surface-basic h-16"
      data-testid="assets-table-loading-more-row"
    >
      {renderAssetSkeletonCells()}
    </TableRow>
  );
}

// The rows table (header sort toggle + the mapped `<AssetRow>`s). Extracted to
// a module-scope helper (no hooks) so `AssetsTableRows` stays one component under
// the line ceiling. `onAction` is wired for every row — all three categories now
// carry a `···` menu (Knowledge: Edit/Download/Delete; Deliverable:
// Download/Delete; Experience: Delete) — and `onOpen` too, because asset-row owns
// the navigability gate. The hint bar (when `hintTab` is set) and the empty
// state (when there are no rows) render inside the card so the header + hint
// stay visible on an empty-but-hinted tab. The surrounding scroll card (and the
// infinite-scroll sentinel) is owned by `AssetsTable`.
function renderAssetsTable({
  visibleRows,
  ariaSort,
  SortGlyph,
  toggleSort,
  onOpen,
  onAction,
  hintTab,
  onDismissHint,
  emptyState,
  isFetchingNextPage,
}: {
  visibleRows: AssetRowData[];
  ariaSort: "ascending" | "descending";
  SortGlyph: LucideIcon;
  toggleSort: () => void;
  onOpen: (row: AssetRowData) => void;
  onAction: (row: AssetRowData, kind: AssetActionKind) => void;
  hintTab: HintTab | null;
  onDismissHint: (tab: HintTab) => void;
  emptyState: React.JSX.Element;
  isFetchingNextPage: boolean;
}): React.JSX.Element {
  return (
    <>
      <Table>
        <TableHeader>
          {/* Sticky column-header row: pinned to the top of the scroll card so
              labels stay visible as the body scrolls. `bg-surface-basic` is
              required (the scrolling rows would otherwise show through), and
              `z-30` sits above the body's pinned cells (z-10) and the pinned
              header cells (z-20) so it covers both when they scroll under it. */}
          <TableRow className="bg-surface-basic sticky top-0 z-30 h-13">
            {PLAIN_HEADERS.map((label, index) => (
              <TableHead
                key={label}
                // ASSET NAME is pinned left; CREATOR caps at 200px so its
                // column sizes to its widest visible name.
                className={cn(
                  "h-13 px-6 text-sm",
                  index === 0 && PIN_HEAD_LEFT,
                  label === "CREATOR" && CREATOR_MAX,
                )}
              >
                {label}
              </TableHead>
            ))}
            <TableHead aria-sort={ariaSort} className="h-13 px-6 text-sm">
              <button
                type="button"
                className="flex items-center gap-1 uppercase"
                onClick={toggleSort}
              >
                CREATED TIME
                <SortGlyph className="text-icon-secondary size-4" />
              </button>
            </TableHead>
            <TableHead
              aria-label="Actions"
              className={cn("h-13 px-2 text-right text-sm", PIN_HEAD_RIGHT)}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hintTab ? renderHintRow(hintTab, onDismissHint) : null}
          {visibleRows.map((row) => (
            <AssetRow
              key={`${row.type}-${row.id}`}
              row={row}
              onOpen={() => onOpen(row)}
              onAction={(kind) => onAction(row, kind)}
            />
          ))}
          {isFetchingNextPage && visibleRows.length > 0
            ? Array.from({ length: LOADING_MORE_ROW_COUNT }, (_, idx) =>
                renderLoadingMoreRow(idx),
              )
            : null}
        </TableBody>
      </Table>
      {visibleRows.length === 0 ? (
        <div className={CENTER}>{emptyState}</div>
      ) : null}
    </>
  );
}

/**
 * The DATA-driven inner of the assets table — the part wrapped by `AssetsTable`'s
 * `<Suspense>` + `<ErrorBoundary>`. Reads the SUSPENSE list query (so a cold load
 * suspends to the bare-skeleton fallback and an error throws to the boundary —
 * no in-component pending/error branch), self-polls extraction status, applies
 * the loaded-rows filter + sort, and renders the rows table (or the empty state).
 * The toolbar, scroll card, and infinite-scroll sentinel live in `AssetsTable`
 * OUTSIDE this Suspense boundary, so they stay mounted across loading/error.
 */
export function AssetsTableRows({
  projectId,
  category,
  search,
  onSearchChange,
  isFetchingNextPage = false,
}: AssetsTableRowsProps): React.JSX.Element {
  const query = useSuspenseAssetsInfiniteQuery(projectId, category);
  const rows = query.data.pages.flatMap((page) => page.items);

  useAssetsPoll(projectId, category, rows);
  useExtractionResultToast(rows);

  // Callback ref for the `group/table` wrapper: the hook toggles its
  // `data-scroll-*`, which the pinned columns read to gate their frosted edge. A
  // callback ref (not a stored ref) so it re-attaches when the conditionally
  // rendered wrapper remounts (e.g. after a search empties then refills).
  const setTableWrapperRef = useTableScrollEdges();

  const { dismissedHints, dismissHint } = useDismissedHints();
  const rowActions = useAssetRowActions(projectId);

  const visibleRows = selectVisibleRows(rows, search);
  const hintTab = resolveHintTab(category, dismissedHints);
  const SortGlyph = search.sort === "asc" ? ArrowUp : ArrowDown;
  const ariaSort = search.sort === "asc" ? "ascending" : "descending";
  const toggleSort = (): void =>
    onSearchChange({ sort: search.sort === "asc" ? "desc" : "asc" });

  // The empty surface (search vs category).
  const emptyState = search.q.trim() ? (
    <AssetsEmpty variant="search" query={search.q} />
  ) : (
    <AssetsEmpty variant="category" category={category} />
  );

  // Render the table when there are rows OR a hint is active — an empty-but-
  // hinted category (e.g. Deliverable) still shows the header + hint bar.
  const showTable = visibleRows.length > 0 || hintTab !== null;

  return (
    <>
      {showTable ? (
        // `group/table` + `data-scroll-*`: the pinned columns read these (set by
        // `useTableScrollEdges`) to gate their frosted edge only while scrollable.
        // Defaults mean "no overflow" → no fade until the hook's first sync.
        <div
          ref={setTableWrapperRef}
          data-testid="assets-table-shell"
          className={cn(
            "group/table contents",
            visibleRows.length === 0 && EMPTY_TABLE,
          )}
          data-scroll-start="true"
          data-scroll-end="true"
        >
          {renderAssetsTable({
            visibleRows,
            ariaSort,
            SortGlyph,
            toggleSort,
            onOpen: rowActions.handleOpen,
            onAction: rowActions.handleAction,
            hintTab,
            onDismissHint: dismissHint,
            emptyState,
            isFetchingNextPage,
          })}
        </div>
      ) : (
        <div className={CENTER}>{emptyState}</div>
      )}
      {renderRowDialogs({ projectId, actions: rowActions })}
    </>
  );
}
