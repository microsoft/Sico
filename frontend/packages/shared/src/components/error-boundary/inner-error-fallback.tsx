import { Button } from "@sico/ui";
import { type ReactElement } from "react";
import type { FallbackProps } from "react-error-boundary";

import { ErrorFallbackChrome } from "./error-fallback-chrome";

/**
 * Inline fallback used by the layout-level `<ErrorBoundary>`. Layout
 * chrome (sidebar, OfflineBanner) stays mounted; the user can retry
 * without losing context.
 */
export function InnerErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps): ReactElement {
  return (
    <ErrorFallbackChrome
      error={error}
      variant="inner"
      titleAs="h2"
      title="Something went wrong on this page."
      body="An unexpected error occurred while rendering this section."
      containerClassName="rounded-lg border border-border bg-background p-6 text-foreground"
      titleClassName="mb-2 text-lg font-medium"
      bodyClassName="mb-4 text-sm text-foreground-tertiary"
      action={
        <Button
          variant="secondary"
          onClick={(): void => {
            resetErrorBoundary();
          }}
        >
          Retry
        </Button>
      }
    />
  );
}
