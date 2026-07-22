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

import { Button } from "@sico/ui";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type ReactElement, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { StudioGrid } from "./studio-grid";
import { ErrorView } from "../../../components/error-view";
import { DigitalWorkersGridSkeleton } from "../../digital-worker/components/digital-workers-grid-skeleton";

/**
 * Feature root for `/studio` — the agent list. Mirrors `<DigitalWorkers>`
 * (fixed header + local-scroll grid + suspense/error boundary), but with
 * Studio copy and a "Create" action that opens create-mode setup, echoing the
 * legacy Studio page (`navigate(RouterPath.DigitalWorkerSetup())`).
 */
export function Studio(): ReactElement {
  const { reset } = useQueryErrorResetBoundary();
  const navigate = useNavigate();
  return (
    <div className="bg-surface-canvas flex h-full w-full flex-col gap-6 pt-6 pb-2">
      <header className="flex items-start justify-between px-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-foreground-primary text-3xl leading-tight font-medium outline-none">
            Studio
          </h1>
          <p className="text-foreground-tertiary text-sm leading-normal">
            Configure and deploy digital worker
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            void navigate({ to: "/studio/setup" });
          }}
        >
          <Plus aria-hidden />
          Create
        </Button>
      </header>
      <div className="scrollbar min-h-0 flex-1 overflow-y-auto px-16 pb-8">
        <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
          <Suspense fallback={<DigitalWorkersGridSkeleton />}>
            <StudioGrid />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
