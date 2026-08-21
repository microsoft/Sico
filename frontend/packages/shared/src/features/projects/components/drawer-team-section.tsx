import {
  AvatarGroup,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sico/ui";
import { Link } from "@tanstack/react-router";
import { ChevronRight, UserRoundPlus } from "lucide-react";
import type * as React from "react";

import { DwAvatar } from "../../../components/dw-avatar/dw-avatar";
import { UserAvatar } from "../../../components/user-avatar/user-avatar";
import { SECTION_TITLE_CLASS } from "../constants";
import { type ProjectDetail } from "../schemas/project";

const MAX_PREVIEW_AVATARS = 3;

// The member-section invite callbacks — the two invite items raise back to the
// parent, which owns the dialogs. (The roster preview is a plain navigation
// link, not a callback.)
export type MemberActions = {
  onInviteHuman: () => void;
  onInviteDw: () => void;
};

// Mixed human + digital-worker avatar preview. Humans (the full member roster)
// come first, then DWs, capped at MAX_PREVIEW_AVATARS. `total` counts the whole
// roster (members + owner-if-missing + DWs). Uses `projectMembers` — the
// complete roster (admins included) — NOT `operatorAdmins`, which is only the
// admin usernames and undercounts non-admin members.
function renderPreview(project: ProjectDetail): React.JSX.Element {
  // `projectMembers` already includes admins; add the owner only if the roster
  // omits them (owner isn't guaranteed to be in the members list).
  const humans = [...project.projectMembers];
  if (!humans.some((m) => m.username === project.ownerUsername)) {
    humans.push({
      id: -1,
      username: project.ownerUsername,
      email: project.ownerUsername,
    });
  }
  const total = humans.length + project.agentInstances.length;
  const avatars: React.ReactNode[] = [];
  for (const member of humans) {
    if (avatars.length >= MAX_PREVIEW_AVATARS) {
      break;
    }
    avatars.push(
      <UserAvatar
        key={`u:${member.username}`}
        user={{
          name: member.alias ?? member.username,
          email: member.email,
          iconUri: member.iconUrl,
        }}
        decorative
        size="xs"
      />,
    );
  }
  for (const agent of project.agentInstances) {
    if (avatars.length >= MAX_PREVIEW_AVATARS) {
      break;
    }
    avatars.push(
      <DwAvatar
        key={`a:${agent.id}`}
        agent={{ iconUri: agent.iconUrl }}
        decorative
        size="xs"
      />,
    );
  }
  return (
    <Link
      to="/project/$projectId/team/operators"
      params={{ projectId: String(project.id) }}
      className="text-foreground-secondary hover:text-foreground-primary flex h-7 items-center gap-2 self-start rounded-md text-sm font-normal transition-colors outline-none focus-visible:ring-2"
    >
      <AvatarGroup>{avatars}</AvatarGroup>
      <span className="flex items-center gap-1">
        {total} workers
        <ChevronRight className="size-4" />
      </span>
    </Link>
  );
}

export type DrawerTeamSectionProps = {
  project: ProjectDetail;
  /** project.manage — gates the Invite→Operator item + the menu. */
  canManageProject: boolean;
  /** dw.manage.own — gates the Invite→Digital worker item. */
  canInviteDw: boolean;
  actions: MemberActions;
};

/**
 * Team section for the project drawer. Reads the roster from `project`
 * (`projectMembers`, inline) and gates the Invite dropdown on capabilities the
 * workspace resolves once and passes down — no per-section fetch, so it appears
 * with the page-level skeleton.
 */
export function DrawerTeamSection({
  project,
  canManageProject,
  canInviteDw,
  actions,
}: DrawerTeamSectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className={SECTION_TITLE_CLASS}>Team</p>
      <div className="flex items-center justify-between gap-4">
        {renderPreview(project)}
        {canManageProject || canInviteDw ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="subtle"
                  size="sm"
                  className="text-foreground-secondary hover:text-foreground-primary active:text-foreground-primary font-normal"
                />
              }
            >
              <UserRoundPlus />
              Invite
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {canManageProject ? (
                <DropdownMenuItem onClick={actions.onInviteHuman}>
                  Human Operator
                </DropdownMenuItem>
              ) : null}
              {canInviteDw ? (
                <DropdownMenuItem onClick={actions.onInviteDw}>
                  Digital Worker
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
