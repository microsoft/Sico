import type * as React from "react";

import { HumansTable } from "./humans-table";
import { MembersEmpty } from "./members-empty";
import { useProjectDetailQuery } from "../../projects/hooks/use-project-query";
import { useProjectPermission } from "../../rbac/hooks/use-project-permission";
import { useProjectMembersSuspenseQuery } from "../hooks/use-project-members-query";

export type MembersPersonTabProps = {
  projectId: number;
};

/** Humans tab (module1): the project's human members as a table. Admins get an
 * editable role dropdown + remove action; non-admins see read-only rows. The
 * page owns the Invite control; this tab only reads + renders. */
export function MembersPersonTab({
  projectId,
}: MembersPersonTabProps): React.JSX.Element {
  const members = useProjectMembersSuspenseQuery(projectId).data;
  // The project owner is pinned + protected in the table; read it from the
  // (already-prefetched, cached) detail query rather than threading it down.
  const ownerUsername = useProjectDetailQuery(projectId).data.ownerUsername;
  const { canManageProject, isLoading } = useProjectPermission(projectId);
  // Hide admin affordances until the permission query settles — treating a
  // pending/errored fetch as non-admin would flash the wrong UI or silently
  // lock a real admin to read-only.
  const canManage = !isLoading && canManageProject;

  if (members.length === 0) {
    return <MembersEmpty variant="humans" />;
  }

  return (
    <HumansTable
      projectId={projectId}
      members={members}
      ownerUsername={ownerUsername}
      canManage={canManage}
    />
  );
}
