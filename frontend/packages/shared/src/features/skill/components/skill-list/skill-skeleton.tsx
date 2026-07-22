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
import type { ReactElement } from "react";

// Mirrors the expanded content (tabs bar + file-explorer shell with header,
// sidebar tree, and code body) so the swap to real content doesn't shift layout.
export function SkillSkeleton(): ReactElement {
  return (
    <div className="flex flex-col" aria-hidden>
      <div className="border-divider flex gap-4 border-b pb-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="border-stroke-subtle-card-rest mt-5 h-96 overflow-hidden rounded-lg border">
        <div className="border-stroke-subtle-card-rest bg-surface-sunken flex h-8 items-center gap-2 border-b px-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex h-[calc(100%-2rem)]">
          <div className="border-divider w-40 shrink-0 space-y-2 border-r p-3">
            {["t1", "t2", "t3", "t4"].map((id) => (
              <Skeleton
                key={id}
                data-testid="skill-skeleton-row"
                className="h-5 w-full"
              />
            ))}
          </div>
          <div className="flex-1 space-y-2 p-3">
            {["c1", "c2", "c3", "c4", "c5"].map((id) => (
              <Skeleton key={id} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
