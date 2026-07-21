import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type * as React from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { KnowledgeTagsContent } from "./knowledge-tags-content";
import { KnowledgeTagsSkeleton } from "./knowledge-tags-skeleton";
import { ErrorView } from "../../../components/error-view";

export type KnowledgeTagsProps = {
  projectId: number;
};

/**
 * Page shell — suspense + error wiring. Piping `reset` into `onReset` is
 * required, else "Try again" remounts but the query stays errored and re-throws.
 */
export function KnowledgeTags({
  projectId,
}: KnowledgeTagsProps): React.JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
      <Suspense fallback={<KnowledgeTagsSkeleton />}>
        <KnowledgeTagsContent projectId={projectId} />
      </Suspense>
    </ErrorBoundary>
  );
}
