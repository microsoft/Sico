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
import { type JSX } from "react";

import { SuggestedTasksSkeleton } from "./suggested-tasks-skeleton";

// Full-page loading fallback for the DW home while the agent query resolves.
// Mirrors DigitalWorkerHomeContent's layout (same centered `-mt-16 max-w-190`
// column) so the swap to the real hero + composer + tasks has no layout jump —
// a content-shaped preview instead of a centered <Spinner>. Reuses the tasks
// skeleton for the bottom section.
export function DigitalWorkerHomeSkeleton(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid="digital-worker-home-skeleton"
      className="bg-surface-canvas min-h-0 w-full flex-1 overflow-y-auto"
    >
      <div className="mx-auto -mt-16 flex h-full max-w-190 flex-col justify-center px-5">
        {/* Hero: avatar (2xl = size-12), a mt-4 gap, then the h-8 identity line —
            matching DigitalWorkerHomeHero's exact spacing. */}
        <div aria-hidden="true" className="mb-6 flex flex-col items-center">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="mt-4 h-8 w-56 rounded-md" />
        </div>
        {/* Composer: the pinned Composer's outer frame — same mx-auto max-w-190
            px-4 pb-5 wrapper and min-h-30 rounded card so heights line up. */}
        <div className="mx-auto w-full max-w-190 px-4 pb-5">
          <Skeleton
            aria-hidden="true"
            className="min-h-30 w-full rounded-2xl"
          />
        </div>
        <SuggestedTasksSkeleton />
      </div>
    </div>
  );
}
