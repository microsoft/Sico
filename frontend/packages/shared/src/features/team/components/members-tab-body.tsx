import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Suspense } from "react";
import type * as React from "react";
import { ErrorBoundary } from "react-error-boundary";

import { WORKER_HEADERS } from "./dw-table";
import { HUMAN_HEADERS } from "./humans-table";
import { MembersDwTab } from "./members-dw-tab";
import { type MembersTab } from "./members-page";
import { MembersPersonTab } from "./members-person-tab";
import { MembersTableSkeleton } from "./members-table-skeleton";
import { ErrorView } from "../../../components/error-view";

export type MembersTabBodyProps = {
  projectId: number;
  activeTab: MembersTab;
};

/** Renders only the active tab's body. Each tab suspends on its own query, so
 * both branches share the same error+suspense boundary shape — the fallback
 * skeleton just mirrors that tab's columns. */
export function MembersTabBody({
  projectId,
  activeTab,
}: MembersTabBodyProps): React.JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  if (activeTab === "workers") {
    return (
      <ErrorBoundary
        FallbackComponent={ErrorView}
        onReset={reset}
        resetKeys={[projectId]}
      >
        <Suspense
          fallback={
            <MembersTableSkeleton
              headers={WORKER_HEADERS}
              label="Loading digital workers"
            />
          }
        >
          <MembersDwTab projectId={projectId} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary
      FallbackComponent={ErrorView}
      onReset={reset}
      resetKeys={[projectId]}
    >
      <Suspense
        fallback={
          <MembersTableSkeleton
            headers={HUMAN_HEADERS}
            label="Loading members"
          />
        }
      >
        <MembersPersonTab projectId={projectId} />
      </Suspense>
    </ErrorBoundary>
  );
}
