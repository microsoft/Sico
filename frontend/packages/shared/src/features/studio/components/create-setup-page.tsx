import { Button } from "@sico/ui";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type JSX, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { CreateSetupBody } from "./create-setup-body";
import { ErrorView } from "../../../components/error-view";

// Create-mode setup (no agentId): the body creates the agent then navigates to
// the edit route. Deploy is shown disabled to match the Figma — it only becomes
// actionable once the agent exists. Mounted by the /studio/setup route, which
// owns only the roles prefetch.
export function CreateSetupPage(): JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <div className="bg-surface-canvas flex h-full w-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between pr-3 pl-4">
        <div className="flex items-center gap-1">
          <Link
            to="/studio"
            aria-label="Back to Studio"
            className="text-foreground-secondary hover:text-foreground-primary inline-flex size-7 items-center justify-center rounded-md no-underline"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Link>
          <h1
            tabIndex={-1}
            className="text-foreground-primary text-base font-medium outline-none"
          >
            Digital worker Setup
          </h1>
        </div>
        <Button variant="secondary" disabled>
          Deploy
        </Button>
      </header>
      <div className="scrollbar min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="mx-auto flex min-h-full w-full max-w-230 flex-col gap-6 px-6 pt-2">
          <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
            <Suspense fallback={null}>
              <CreateSetupBody />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
