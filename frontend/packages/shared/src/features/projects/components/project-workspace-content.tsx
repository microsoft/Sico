/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { Button, toast } from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { PanelLeft } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { AddKnowledgeDialog } from "./add-knowledge-dialog";
import { AssetsTable } from "./assets-table";
import { EditProjectDialog } from "./edit-project-dialog";
import { ProjectDrawer } from "./project-drawer";
import { ProjectPageHeader } from "./project-page-header";
import { projectDrawerCollapsedAtom } from "../atoms/project-workspace-atom";
import { useKnowledgeTagsQuery } from "../hooks/use-knowledge-tags-query";
import { useProjectMutation } from "../hooks/use-project-mutation";
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
 * Suspending body of the per-project workspace. It reads the two suspending
 * queries (project detail + knowledge tags), owns the drawer-collapse and the
 * two dialog-open flags, and composes the four already-built pieces:
 * `<AssetsTable>` (left), `<ProjectDrawer>` (right), and the `<AddKnowledgeDialog>`
 * / `<EditProjectDialog>` it toggles. It fetches nothing the children don't —
 * everything below is presentational and raises callbacks back up to here.
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
  const { items: knowledgeTags } = useKnowledgeTagsQuery(projectId).data;
  // Held in a per-project atom (not `useState`) so the drawer-collapse survives
  // the category-tab route remount AND stays isolated per project — see
  // `projectDrawerCollapsedAtom`.
  const [collapsed, setCollapsed] = useAtom(
    projectDrawerCollapsedAtom(projectId),
  );
  const [addKnowledgeOpen, setAddKnowledgeOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const navigate = useNavigate();
  const mutation = useProjectMutation(projectId);

  // Operator remove sends the FULL remaining operator set (the add path does the
  // same): PUT /project runs syncProjectAdmins unconditionally, so the explicit
  // list — not an omission — is what removes one without wiping the rest.
  const handleRemoveOperator = (username: string): void => {
    const next = project.operatorAdmins.filter((u) => u !== username);
    mutation.mutate(
      { operatorAdmins: next },
      {
        onError: () => {
          toast.error("We couldn't remove this operator. Try again.");
        },
      },
    );
  };

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
              onAddKnowledge={() => setAddKnowledgeOpen(true)}
            />
          </div>
        </div>
        {collapsed ? null : (
          <ProjectDrawer
            project={project}
            knowledgeTags={knowledgeTags}
            onEditProject={() => setEditProjectOpen(true)}
            onRemoveOperator={handleRemoveOperator}
            onViewAllKnowledgeTags={() => {
              void navigate({
                to: "/project/$projectId/knowledge-tags",
                params: { projectId: String(projectId) },
              });
            }}
            onToggleCollapse={() => setCollapsed(true)}
          />
        )}
      </div>
      <AddKnowledgeDialog
        projectId={projectId}
        open={addKnowledgeOpen}
        onOpenChange={setAddKnowledgeOpen}
      />
      <EditProjectDialog
        project={project}
        open={editProjectOpen}
        onOpenChange={setEditProjectOpen}
      />
    </>
  );
}
