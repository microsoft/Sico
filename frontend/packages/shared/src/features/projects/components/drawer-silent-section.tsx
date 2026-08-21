import type * as React from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { logger } from "../../../utils/logger";

export type SilentSectionProps = {
  /** Section name for the logged error, e.g. "sandbox". */
  name: string;
  /** Skeleton shown while the section's own query suspends. */
  fallback: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Wraps a self-fetching drawer section in its own Suspense (section skeleton) +
 * a SILENT ErrorBoundary. On failure the section renders NOTHING (`fallback=
 * null`) and only logs — the narrow `w-80` drawer must not show an error card
 * (decision: console error only). Mirrors the `asset-detail-panel.tsx` pattern
 * of wrapping `AddKnowledgeTagArea` in `<ErrorBoundary fallback={null}>`.
 */
export function SilentSection({
  name,
  fallback,
  children,
}: SilentSectionProps): React.JSX.Element {
  return (
    <ErrorBoundary
      fallback={null}
      onError={(error) =>
        logger.error(`drawer ${name} section failed`, { error })
      }
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
