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

import { Skeleton } from "@sico/ui";
import type * as React from "react";

import { AssetsTableSkeleton } from "./assets-table-skeleton";
import { ProjectDrawerSkeleton } from "./project-drawer-skeleton";

/**
 * Content-shaped loading surface for {@link ProjectWorkspace} — a `Skeleton`
 * mirror of the two-column shell (left: a `ProjectPageHeader`-shaped back bar +
 * title + the assets table; right: the project drawer), never a spinner, so the
 * layout does not reflow when the project-detail + knowledge-tags queries resolve.
 * The left column matches the real `px-16` gutter and reuses
 * {@link AssetsTableSkeleton} (toolbar + table card) so the assets area mirrors
 * the real second-stage load instead of anonymous bars; the right column reuses
 * {@link ProjectDrawerSkeleton}. Both nested blocks are `aria-hidden`; the root
 * `role="status"` carries the single loading intent.
 */
export function ProjectWorkspaceSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading project"
      className="bg-surface-canvas flex h-full min-h-0"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          aria-hidden="true"
          className="flex h-12 shrink-0 items-center gap-1 px-5"
        >
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div
          aria-hidden="true"
          className="flex min-h-0 flex-1 flex-col px-5 pt-11 pb-10 lg:px-16"
        >
          <Skeleton className="mb-5 h-9 w-64" />
          <AssetsTableSkeleton asNestedBlock />
        </div>
      </div>
      <ProjectDrawerSkeleton />
    </div>
  );
}
