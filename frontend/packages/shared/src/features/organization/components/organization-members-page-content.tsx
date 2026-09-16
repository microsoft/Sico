import { useLingui } from "@lingui/react/macro";
import { Button } from "@sico/ui";
import { Pencil } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

import { EditOrgNameDialog } from "./edit-org-name-dialog";
import { OrganizationMembersSection } from "./organization-members-section";
import { useOrganizationMembersQuery } from "../../membership";
import { useOrganizationPermission } from "../../rbac/hooks/use-organization-permission";
import { useOrganizationDetailQuery } from "../hooks/use-organization-query";
import { type OrganizationSummary } from "../schemas/organization";

export function OrganizationMembersPageContent({
  organization,
}: {
  organization: OrganizationSummary;
}): React.JSX.Element {
  const organizationId = organization.id;
  const { t } = useLingui();
  const organizationDetail = useOrganizationDetailQuery(organizationId).data;
  const members = useOrganizationMembersQuery(organizationId).data;
  const { canManageOrganizationMembers, canRenameOrganization, currentUserId } =
    useOrganizationPermission();
  const [editName, setEditName] = useState(false);
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden px-16 pt-10 pb-13">
      <div className="flex items-center gap-1.5">
        <h1
          tabIndex={-1}
          className="text-foreground-primary text-3xl font-medium"
        >
          {organizationDetail.name}
        </h1>
        {canRenameOrganization ? (
          <Button
            variant="subtle"
            size="icon-xs"
            aria-label={t({
              id: "organization.edit.open",
              message: "Edit organization",
            })}
            onClick={() => setEditName(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <OrganizationMembersSection
        organizationId={organizationId}
        orgName={organizationDetail.name}
        members={members}
        canManage={canManageOrganizationMembers}
        currentUserId={currentUserId}
        ownerUsername={organization.creatorUsername}
        currentUserIsOwner={organization.isOwner}
      />
      {canRenameOrganization ? (
        <EditOrgNameDialog
          organizationId={organizationId}
          currentName={organizationDetail.name}
          currentIconUrl={organizationDetail.iconUrl}
          open={editName}
          onOpenChange={setEditName}
        />
      ) : null}
    </div>
  );
}
