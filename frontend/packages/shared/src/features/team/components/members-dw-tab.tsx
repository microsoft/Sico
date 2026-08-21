import { useEffect, useState } from "react";
import type * as React from "react";

import { DigitalWorkersTable } from "./dw-table";
import { MembersEmpty } from "./members-empty";
import { ReassignDwDialog } from "./reassign-dw-dialog";
import {
  useDedupedAgents,
  useSuspenseAgentsInfiniteQuery,
} from "../../digital-worker/hooks/use-agents-query";
import { useProjectPermission } from "../../rbac/hooks/use-project-permission";

export type MembersDwTabProps = {
  projectId: number;
};

/** Digital workers tab (module3): the project's DWs as a table with admin-gated
 * reassign / dismiss row actions. Fetches the project-scoped agents list (the
 * backend filters by `projectId`). First-page loading + errors are owned by the
 * tab's Suspense + ErrorBoundary (in members-tab-body); only the incremental
 * page-drain skeleton lives here (see below). The page owns the Add control. */
export function MembersDwTab({
  projectId,
}: MembersDwTabProps): React.JSX.Element {
  const agentsQuery = useSuspenseAgentsInfiniteQuery({
    projectId,
    // Inactive DWs belong in the Team roster (shown with a muted "Inactive"
    // pill) — unlike the sidebar/dashboard "my DWs" preview, which hides them.
    showInactive: true,
  });
  // Backend-filtered to this project, but still paginated — drain every page so
  // a project with >50 workers doesn't silently drop the tail.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = agentsQuery;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const agents = useDedupedAgents(agentsQuery.data.pages);
  const { canManageDw, canInviteDw, userEmail, isLoading } =
    useProjectPermission(projectId);
  // Hide admin affordances until the permission query settles — a
  // pending/errored fetch must not read as a confirmed non-admin.
  const settled = !isLoading;
  const [reassignFor, setReassignFor] = useState<number | null>(null);

  // Suspense owns the FIRST page's loading. Later pages are drained via
  // `fetchNextPage` (which never suspends), so the table stays mounted and shows
  // trailing "loading more" rows instead of being swapped for a full skeleton —
  // no flicker, and an open Reassign dialog survives the drain.
  if (agents.length === 0 && !isFetchingNextPage) {
    return <MembersEmpty variant="workers" />;
  }

  return (
    <>
      <DigitalWorkersTable
        agents={agents}
        canManageDw={settled && canManageDw}
        canInviteDw={settled && canInviteDw}
        userEmail={userEmail}
        onReassign={setReassignFor}
        isFetchingNextPage={isFetchingNextPage}
      />
      {reassignFor !== null ? (
        <ReassignDwDialog
          projectId={projectId}
          agentId={reassignFor}
          open
          onOpenChange={(next) => {
            if (!next) {
              setReassignFor(null);
            }
          }}
        />
      ) : null}
    </>
  );
}
