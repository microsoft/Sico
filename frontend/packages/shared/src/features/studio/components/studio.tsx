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
