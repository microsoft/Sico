import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Suspense } from "react";
import type * as React from "react";
import { ErrorBoundary } from "react-error-boundary";

import { SandboxPageContent } from "./sandbox-page-content";
import { SandboxPageSkeleton } from "./sandbox-page-skeleton";
import { ErrorView } from "../../../components/error-view";

export type SandboxPageProps = {
  projectId: number;
};

/** Full-page sandbox device list for a project. Reads the project detail
 * (suspense) for the breadcrumb, then renders the toolbar (status tabs + search)
 * over the card-wrapped device table — mirroring the members page chrome. */
export function SandboxPage({
  projectId,
}: SandboxPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const { reset } = useQueryErrorResetBoundary();
  return (
    <div className="bg-surface-canvas flex h-full min-h-0 flex-col overflow-hidden">
      <ErrorBoundary
        FallbackComponent={ErrorView}
        onReset={reset}
        resetKeys={[projectId]}
      >
        <Suspense fallback={<SandboxPageSkeleton />}>
          <SandboxPageContent
            projectId={projectId}
            onBack={() => {
              void navigate({
                to: "/project/$projectId",
                params: { projectId: String(projectId) },
              });
            }}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
