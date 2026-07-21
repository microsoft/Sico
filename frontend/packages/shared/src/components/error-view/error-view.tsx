import { Button } from "@sico/ui";
import { useEffect } from "react";
import type * as React from "react";
import type { FallbackProps } from "react-error-boundary";

import errorIllustrationUrl from "../../assets/error.svg";
import { classifyError } from "../../utils/classify-error";
import { logger } from "../../utils/logger";
import { MessageState } from "../message-state";

const COPY = {
  network: {
    heading: "Can't reach the server",
    body: "Check your connection and try again.",
  },
  server: {
    heading: "Something went wrong",
    body: "Something went wrong on our end. Try again in a moment.",
  },
  schema: {
    heading: "Unexpected response",
    body: "We received unexpected data. Try refreshing the page.",
  },
  unknown: {
    heading: "Something went wrong",
    body: "Something went wrong on this page. Try again.",
  },
} as const;

export type ErrorViewKind = keyof typeof COPY;

/**
 * Shared `<ErrorBoundary FallbackComponent>` for suspense-backed list
 * pages. Classifies the thrown error to pick copy; `resetErrorBoundary`
 * is wired through to React Query's `useQueryErrorResetBoundary` reset
 * by the parent feature root, so "Try again" both remounts the subtree
 * and clears the query's error state in one shot.
 *
 * Self-centering: delegates to `<MessageState fill>`, whose wrapper carries the
 * `role="alert"` and fills + centers in its boundary's content area — so
 * features mount it directly as the `FallbackComponent` with no per-feature
 * centering wrapper, and the fill class lives in exactly one place
 * (`flex-1 min-h-0` covers in-card boundaries, `h-full` covers full-page ones).
 */
export function ErrorView({
  error,
  resetErrorBoundary,
}: FallbackProps): React.JSX.Element {
  const kind = classifyError(error);
  const copy = COPY[kind];
  // Mirror the boundary chrome's one-shot logging side-effect: feature
  // pages were a logging blind spot. Keyed on `error` so it fires once
  // per caught error, not on every render.
  useEffect(() => {
    logger.error("ErrorView caught", { error, kind });
  }, [error, kind]);
  return (
    <MessageState
      fill
      role="alert"
      illustrationUrl={errorIllustrationUrl}
      illustrationWidth={180}
      illustrationHeight={100}
      heading={copy.heading}
      body={copy.body}
      action={
        <Button variant="primary" onClick={resetErrorBoundary}>
          Try again
        </Button>
      }
    />
  );
}
