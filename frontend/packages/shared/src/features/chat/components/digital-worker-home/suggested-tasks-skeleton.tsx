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
import { type JSX } from "react";

// Loading fallback for the suggested-tasks Suspense boundary on the DW home: the
// "SUGGESTED TASKS" divider over three placeholder rows shaped like TaskRow
// (icon chip + message line, py-2) so the swap to real rows has no height jump.
// No entrance animation — a loading placeholder shows immediately (the
// <Skeleton> pulse already signals "loading"); the reveal stagger belongs to the
// real content.
export function SuggestedTasksSkeleton(): JSX.Element {
  // Distinct widths double as React keys — no array-index key needed.
  const ROW_WIDTHS = ["w-3/4", "w-2/3", "w-2/5"];
  return (
    <div className="mt-6 flex flex-col gap-2 pb-2" aria-hidden="true">
      <div className="flex items-center gap-2">
        <span className="text-foreground-faint text-xs tracking-wider uppercase">
          Suggested tasks
        </span>
        <span className="border-divider flex-1 border-t" />
      </div>
      {ROW_WIDTHS.map((width) => (
        // Mirrors TaskRow: gap-3 + py-2 around a size-7 chip and a message line.
        <div key={width} className="flex items-center gap-3 py-2 pr-3 pl-1">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className={cn("h-4", width)} />
        </div>
      ))}
    </div>
  );
}
