import type * as React from "react";

import { CollapsiblePanelShell } from "./collapsible-panel-shell";
import { DrawerActionsMenu } from "./drawer-actions-menu";
import { DrawerEditButton } from "./drawer-edit-button";
import { DrawerKnowledgeSection } from "./drawer-knowledge-section";
import { DrawerKnowledgeSkeleton } from "./drawer-knowledge-skeleton";
import { DrawerSandboxSection } from "./drawer-sandbox-section";
import { SilentSection } from "./drawer-silent-section";
import { DrawerTeamSection, type MemberActions } from "./drawer-team-section";
import { ProjectAvatar } from "../../../components/project-avatar";
import { type ProjectDetail } from "../schemas/project";

const DIVIDER = <hr className="border-divider w-full border-t border-solid" />;

// The capabilities the drawer gates on — resolved ONCE at the workspace level
// (`useProjectPermissionSuspense`) and threaded down, so no drawer section
// self-fetches permission.
export type DrawerPermission = {
  canManageProject: boolean;
  canInviteDw: boolean;
};

// Meta block: an avatar row with the edit pencil right-aligned to the section,
// then name + description below. The pencil is permission-gated (admins only);
// permission comes from the workspace prop, so the whole meta block resolves
// with the page-level skeleton.
function renderMeta(
  project: ProjectDetail,
  canManageProject: boolean,
  onEditProject: () => void,
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-1">
        <ProjectAvatar project={project} size="lg" decorative />
        <DrawerEditButton
          canManageProject={canManageProject}
          onEditProject={onEditProject}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-foreground-primary truncate text-base leading-tight font-medium">
          {project.name}
        </p>
        <p className="text-foreground-tertiary text-sm leading-snug">
          {project.description}
        </p>
      </div>
    </div>
  );
}

export type ProjectDrawerProps = {
  project: ProjectDetail;
  projectId: number;
  /** Capabilities resolved at the workspace level (see `DrawerPermission`). */
  permission: DrawerPermission;
  onEditProject: () => void;
  onDeleteProject: () => void;
  /** Opens the invite-a-human dialog — the parent owns the dialog state. */
  onInviteHuman: () => void;
  /** Opens the invite-a-digital-worker dialog — parent-owned state. */
  onInviteDw: () => void;
  onToggleCollapse: () => void;
};

/**
 * Right-column panel for the per-project workspace. Meta / Team / Sandbox all
 * read from the resolved `project` + the `permission` prop (both resolved at the
 * workspace level under the page-level suspense), so they appear together with
 * the page skeleton — no per-section pop-in. Only the Knowledge-tags section has
 * a genuine external dependency, so it alone keeps its own {@link SilentSection}
 * (section skeleton + silent error boundary). The "view more" affordances are
 * real router links (Team roster, Sandbox, Knowledge tags) — no navigate props.
 */
export function ProjectDrawer({
  project,
  projectId,
  permission,
  onEditProject,
  onDeleteProject,
  onInviteHuman,
  onInviteDw,
  onToggleCollapse,
}: ProjectDrawerProps): React.JSX.Element {
  const memberActions: MemberActions = {
    onInviteHuman,
    onInviteDw,
  };
  return (
    <CollapsiblePanelShell
      label="Project details"
      onCollapse={onToggleCollapse}
      actions={
        <DrawerActionsMenu
          canManageProject={permission.canManageProject}
          onRequestDelete={onDeleteProject}
        />
      }
    >
      {renderMeta(project, permission.canManageProject, onEditProject)}
      <DrawerTeamSection
        project={project}
        canManageProject={permission.canManageProject}
        canInviteDw={permission.canInviteDw}
        actions={memberActions}
      />
      {DIVIDER}
      <DrawerSandboxSection
        sandboxes={project.sandboxes}
        projectId={projectId}
      />
      {DIVIDER}
      <SilentSection name="knowledge" fallback={<DrawerKnowledgeSkeleton />}>
        <DrawerKnowledgeSection projectId={projectId} />
      </SilentSection>
    </CollapsiblePanelShell>
  );
}
