import { Button } from "@sico/ui";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type ReactElement, Suspense, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { AddDwDialog } from "./add-dw-dialog";
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
  const [addOpen, setAddOpen] = useState(false);

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
            Collaborate with, train, and supervise your Digital Workers.
          </p>
        </div>
        {/* Always the primary action: the Add DW dialog itself handles the
            "no project yet → Create Project" branch, so the header button
            never needs to know whether a project exists. */}
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus aria-hidden="true" />
          Add Digital Worker
        </Button>
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
            <DigitalWorkersGrid onAddDw={() => setAddOpen(true)} />
          </Suspense>
        </ErrorBoundary>
      </div>
      {addOpen && <AddDwDialog open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}
