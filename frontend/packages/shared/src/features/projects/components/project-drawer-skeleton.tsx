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
import { cn } from "@sico/ui/lib/utils.ts";
import type * as React from "react";

const SKELETON_OPERATOR_COUNT = 3;
const SKELETON_CHIP_WIDTHS = ["w-32", "w-20", "w-28"] as const;

/**
 * Content-shaped loading surface for {@link ProjectDrawer}: a `Skeleton` mirror
 * of the drawer's meta / workers / operators / knowledge-tags shape — never a
 * spinner — so the panel does not reflow when the real `projectDetail` +
 * `knowledgeTags` queries resolve. A building block (like `ProjectCardSkeleton`):
 * the whole section is `aria-hidden` and carries no `role="status"`, because
 * its only consumer — `ProjectWorkspaceSkeleton` — owns the single live region
 * (the drawer has no own Suspense boundary; its data resolves with the rest of
 * `ProjectWorkspaceContent`).
 */
export function ProjectDrawerSkeleton(): React.JSX.Element {
  return (
    <section
      aria-hidden="true"
      data-testid="project-drawer-skeleton"
      className="border-divider flex h-full w-90 shrink-0 flex-col border-l"
    >
      <div className="flex h-12 items-center justify-between px-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-7" />
      </div>
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <hr className="border-divider w-full border-t border-solid" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: SKELETON_OPERATOR_COUNT }, (_, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-44" />
            </div>
          ))}
        </div>
        <hr className="border-divider w-full border-t border-solid" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-5 w-32" />
          <div className="flex flex-wrap gap-2">
            {SKELETON_CHIP_WIDTHS.map((width) => (
              <Skeleton key={width} className={cn("h-6 rounded-sm", width)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
