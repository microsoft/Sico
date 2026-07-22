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

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type * as React from "react";
import { Suspense, useRef } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AssetsTableRows } from "./assets-table-rows";
import { AssetsTableSkeleton } from "./assets-table-skeleton";
import { AssetsToolbar } from "./assets-toolbar";
import { ErrorView } from "../../../components/error-view";
import { useInfiniteScrollSentinel } from "../../../hooks/use-infinite-scroll-sentinel";
import { useAssetsInfiniteQuery } from "../hooks/use-assets-query";
import type { AssetSearch } from "../schemas/asset-search";
import type { AssetCategory } from "../types";

export type AssetsTableProps = {
  projectId: number;
  /** The active category from the route path (drives which endpoint loads). */
  category: AssetCategory;
  search: AssetSearch;
  onSearchChange: (next: Partial<AssetSearch>) => void;
  /** Opens the parent's Add Knowledge dialog (toolbar lives here per Figma). */
  onAddKnowledge: () => void;
};

/**
 * Persistent SHELL of the per-project assets table. The toolbar (category tabs),
 * the bounded scroll card, and the infinite-scroll sentinel live HERE and stay
 * mounted across every query state — they never suspend. Inside the card, the
 * data-driven `<AssetsTableRows>` is wrapped in a LOCAL `<Suspense>` +
 * `<ErrorBoundary>`: a cold load suspends to the bare skeleton (toolbar/tabs stay
 * put), an error renders the in-card `<ErrorView>` (the page chrome stays put).
 *
 * The sentinel's pagination state comes from `useAssetsInfiniteQuery` (the
 * non-suspense surface), which shares the same cache entry as the rows' suspense
 * query — so there is no extra request, and the sentinel keeps working even while
 * the inner rows suspend (it is outside the boundary). This is the C1/C2 fix:
 * the once-only observer effect finds the sentinel in the DOM on the first
 * commit, and roots on the bounded scroll card (not the viewport).
 *
 * `useQueryErrorResetBoundary` is critical: its `reset` must feed the
 * `ErrorBoundary.onReset`, otherwise "Try again" remounts the subtree but the
 * failed suspense query stays cached and immediately throws again.
 */
export function AssetsTable({
  projectId,
  category,
  search,
  onSearchChange,
  onAddKnowledge,
}: AssetsTableProps): React.JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  const pager = useAssetsInfiniteQuery(projectId, category);

  const scrollCardRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useInfiniteScrollSentinel(
    sentinelRef,
    {
      hasNextPage: pager.hasNextPage,
      isFetchingNextPage: pager.isFetchingNextPage,
      fetchNextPage: pager.fetchNextPage,
    },
    { rootRef: scrollCardRef },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <AssetsToolbar
        projectId={projectId}
        category={category}
        search={search}
        onSearchChange={onSearchChange}
        onAddKnowledge={onAddKnowledge}
      />

      {/* Persistent scroll card: the observer root, and the sentinel lives in it
          so the once-only observer effect attaches on the very first commit
          (even while the cold-load skeleton shows). Only the inner rows suspend;
          the card + sentinel never unmount. */}
      <div
        ref={scrollCardRef}
        className="scrollbar-none bg-surface-basic shadow-m **:data-[slot=table-container]:scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl **:data-[slot=table-container]:flex-1"
      >
        <ErrorBoundary
          onReset={reset}
          resetKeys={[projectId, category]}
          FallbackComponent={ErrorView}
        >
          <Suspense fallback={<AssetsTableSkeleton variant="bare" />}>
            <AssetsTableRows
              projectId={projectId}
              category={category}
              search={search}
              onSearchChange={onSearchChange}
              isFetchingNextPage={pager.isFetchingNextPage}
            />
          </Suspense>
        </ErrorBoundary>
        {/* Infinite-scroll sentinel. The "loading more" affordance is content-
            shaped skeleton rows appended inside the rows TableBody so the table
            does not reflow when the next page arrives. */}
        <div ref={sentinelRef} aria-hidden="true" />
      </div>
    </div>
  );
}
