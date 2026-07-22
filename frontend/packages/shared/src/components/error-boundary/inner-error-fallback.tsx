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
