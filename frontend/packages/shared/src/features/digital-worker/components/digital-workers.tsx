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
import { type ReactElement, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { DigitalWorkersGrid } from "./digital-workers-grid";
import { DigitalWorkersGridSkeleton } from "./digital-workers-grid-skeleton";
import { ErrorView } from "../../../components/error-view";

/**
 * Feature root for `/digital-worker`. `useQueryErrorResetBoundary` is
 * critical: without piping its `reset` into `ErrorBoundary.onReset`,
 * "Retry" remounts the subtree but the failed query stays in error
 * state, so the suspense hook re-throws on remount and the user is
 * stuck.
 *
 * Layout: the header stays fixed; the grid below owns its own scroll region +
 * a fixed inactive-toggle footer (three-part flex). This wrapper only bounds
 * the height (`flex-1 min-h-0`) — it does NOT scroll.
 */
export function DigitalWorkers(): ReactElement {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <div className="flex h-full w-full flex-col gap-6 pt-10 pb-2">
      <header className="flex items-start justify-between gap-4 px-16">
        <div className="flex flex-col gap-1">
          <h1
            tabIndex={-1}
            className="text-foreground-primary text-3xl leading-tight font-medium outline-none"
          >
            Digital Workers
          </h1>
          <p className="text-foreground-secondary text-sm leading-normal">
            Browse your digital workforce
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
          <Suspense
            fallback={
              <div className="px-16">
                <DigitalWorkersGridSkeleton />
              </div>
            }
          >
            <DigitalWorkersGrid />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
