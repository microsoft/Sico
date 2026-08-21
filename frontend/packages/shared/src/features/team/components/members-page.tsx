import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Suspense } from "react";
import type * as React from "react";
import { ErrorBoundary } from "react-error-boundary";

import { MembersPageContent } from "./members-page-content";
import { MembersPageSkeleton } from "./members-page-skeleton";
import { ErrorView } from "../../../components/error-view";

/** Which members tab this route mounts. Each tab is its own URL
 * (`/team/operators`, `/team/digital-workers`), so the active tab is a
 * route prop, not local state — mirrors the asset-category tabs. */
export type MembersTab = "humans" | "workers";

// The two members tabs, PATH-driven like the asset-category tabs: each trigger
// renders a router <Link>, so the active tab derives from the URL and is a
// shareable/back-navigable route rather than local Tabs state.
export const MEMBERS_TABS: readonly {
  value: MembersTab;
  label: string;
  to: string;
}[] = [
  {
    value: "humans",
    label: "Human Operators",
    to: "/project/$projectId/team/operators",
  },
  {
    value: "workers",
    label: "Digital Workers",
    to: "/project/$projectId/team/digital-workers",
  },
];

export type MembersPageProps = {
  projectId: number;
  activeTab: MembersTab;
};

/** Full-page project MEMBERS route body. Reads the project detail (suspense) for
 * the breadcrumb + last-active fallback, then renders the active tab (Humans or
 * Digital workers) whose highlight follows the URL. */
export function MembersPage({
  projectId,
  activeTab,
}: MembersPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const { reset } = useQueryErrorResetBoundary();
  return (
    <div className="bg-surface-canvas flex h-full min-h-0 flex-col overflow-hidden">
      <ErrorBoundary
        FallbackComponent={ErrorView}
        onReset={reset}
        resetKeys={[projectId]}
      >
        <Suspense fallback={<MembersPageSkeleton activeTab={activeTab} />}>
          <MembersPageContent
            projectId={projectId}
            activeTab={activeTab}
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
