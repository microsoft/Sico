import { Button } from "@sico/ui";
import { type ReactElement } from "react";
import type { FallbackProps } from "react-error-boundary";

import { ErrorFallbackChrome } from "./error-fallback-chrome";

/**
 * Full-screen fallback for failures during Provider init (the outer
 * boundary in `app.tsx`). The only path forward is a hard reload.
 *
 * Renders `<h1>` deliberately: by the time this mounts, the entire
 * `<RouterProvider>` subtree has unmounted, so no concurrent route-level
 * `<h1>` exists. The inner fallback uses `<h2>` because it renders
 * inside a layout that already owns the page-level `<h1>`.
 *
 * `resetErrorBoundary` is omitted from the public type because recovery
 * is a hard reload, not a boundary reset.
 */
export type OuterErrorFallbackProps = Omit<
  FallbackProps,
  "resetErrorBoundary"
> & {
  // Defaults to `window.location.reload`. Override for testability.
  onReload?: () => void;
};

export function OuterErrorFallback({
  error,
  onReload,
}: OuterErrorFallbackProps): ReactElement {
  const handleReload = (): void => {
    (
      onReload ??
      ((): void => {
        window.location.reload();
      })
    )();
  };
  return (
    <ErrorFallbackChrome
      error={error}
      variant="outer"
      titleAs="h1"
      title="Application failed to start."
      body="Please reload the page to try again."
      containerClassName="fixed inset-0 z-50 flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground"
      titleClassName="mb-2 text-2xl font-medium"
      bodyClassName="mb-6 text-sm text-foreground-tertiary"
      action={
        <Button variant="secondary" onClick={handleReload}>
          Reload
        </Button>
      }
    />
  );
}
