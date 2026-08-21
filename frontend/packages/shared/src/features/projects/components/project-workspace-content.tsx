import { Button } from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { PanelLeft } from "lucide-react";
import type * as React from "react";

import { AssetsTable } from "./assets-table";
import { ProjectDrawer } from "./project-drawer";
import { ProjectPageHeader } from "./project-page-header";
import { useDialogState, WorkspaceDialogs } from "./workspace-dialogs";
import { useProjectPermissionSuspense } from "../../rbac";
import { projectDrawerCollapsedAtom } from "../atoms/project-workspace-atom";
import { useProjectDetailQuery } from "../hooks/use-project-query";
import type { AssetSearch } from "../schemas/asset-search";
import type { AssetCategory } from "../types";

type ProjectWorkspaceContentProps = {
  projectId: number;
  category: AssetCategory;
  search: AssetSearch;
  onSearchChange: (next: Partial<AssetSearch>) => void;
};

/**
 * Suspending body of the per-project workspace. Reads the project-detail query
 * AND the permission query (both suspend under the page-level Suspense), owns
 * the drawer-collapse + dialog flags, and composes `<AssetsTable>` (left) +
 * `<ProjectDrawer>` (right). The drawer's meta / Team / Sandbox all resolve from
 * `project` + the passed `permission` (no per-section fetch); only the Knowledge
 * section still self-fetches behind its own boundary.
 *
 * The dialogs stay mounted (they own their own visibility via `open`); the
 * drawer unmounts when collapsed so the left column reclaims the width.
 */
export function ProjectWorkspaceContent({
  projectId,
  category,
  search,
  onSearchChange,
}: ProjectWorkspaceContentProps): React.JSX.Element {
  const project = useProjectDetailQuery(projectId).data;
  // Resolve permission ONCE here (suspends under the same page-level Suspense as
  // the detail query) so the drawer's edit/actions/team gate on props instead of
  // each self-fetching — the whole drawer then appears with the page skeleton.
  const permission = useProjectPermissionSuspense(projectId);
  // Held in a per-project atom (not `useState`) so the drawer-collapse survives
  // the category-tab route remount AND stays isolated per project — see
  // `projectDrawerCollapsedAtom`.
  const [collapsed, setCollapsed] = useAtom(
    projectDrawerCollapsedAtom(projectId),
  );
  const state = useDialogState();
  const navigate = useNavigate();

  return (
    <>
      <div className="bg-surface-canvas flex h-full min-h-0 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <ProjectPageHeader
            label="All Projects"
            onBack={() => {
              void navigate({ to: "/project" });
            }}
            rightSlot={
              collapsed ? (
                <Button
                  variant="subtle"
                  size="icon-sm"
                  aria-label="Show panel"
                  onClick={() => setCollapsed(false)}
                >
                  <PanelLeft />
                </Button>
              ) : undefined
            }
          />
          <div className="flex min-h-0 flex-1 flex-col px-5 pt-11 pb-10 lg:px-16">
            <h1
              tabIndex={-1}
              className="text-foreground-primary mb-5 text-3xl leading-tight font-medium outline-none"
            >
              {project.name}
            </h1>
            <AssetsTable
              projectId={projectId}
              category={category}
              search={search}
              onSearchChange={onSearchChange}
              onAddKnowledge={() => state.setAddKnowledgeOpen(true)}
            />
          </div>
        </div>
        {collapsed ? null : (
          <ProjectDrawer
            project={project}
            projectId={projectId}
            permission={permission}
            onEditProject={() => state.setEditProjectOpen(true)}
            onDeleteProject={() => state.setDeleteProjectOpen(true)}
            onInviteHuman={() => state.setInviteHuman(true)}
            onInviteDw={() => state.setInviteDw(true)}
            onToggleCollapse={() => setCollapsed(true)}
          />
        )}
      </div>
      <WorkspaceDialogs project={project} projectId={projectId} state={state} />
    </>
  );
}
