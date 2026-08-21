import { toast } from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import type * as React from "react";
import { useState } from "react";

import { AddKnowledgeDialog } from "./add-knowledge-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { InviteDwDialog } from "../../team/components/invite-dw-dialog";
import { InviteMemberDialog } from "../../team/components/invite-member-dialog";
import { useDeleteProjectMutation } from "../hooks/use-delete-project-mutation";
import type { ProjectDetail } from "../schemas/project";

// Bundles the four dialog open-flags + their setters so the workspace body can
// hand them to `WorkspaceDialogs` in one prop and stay under the line cap.
export type DialogState = {
  addKnowledgeOpen: boolean;
  setAddKnowledgeOpen: (open: boolean) => void;
  editProjectOpen: boolean;
  setEditProjectOpen: (open: boolean) => void;
  deleteProjectOpen: boolean;
  setDeleteProjectOpen: (open: boolean) => void;
  inviteHuman: boolean;
  setInviteHuman: (open: boolean) => void;
  inviteDw: boolean;
  setInviteDw: (open: boolean) => void;
};

export function useDialogState(): DialogState {
  const [addKnowledgeOpen, setAddKnowledgeOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [inviteHuman, setInviteHuman] = useState(false);
  const [inviteDw, setInviteDw] = useState(false);
  return {
    addKnowledgeOpen,
    setAddKnowledgeOpen,
    editProjectOpen,
    setEditProjectOpen,
    deleteProjectOpen,
    setDeleteProjectOpen,
    inviteHuman,
    setInviteHuman,
    inviteDw,
    setInviteDw,
  };
}

export type WorkspaceDialogsProps = {
  project: ProjectDetail;
  projectId: number;
  state: DialogState;
};

// The workspace's four self-managed dialogs, split out of the workspace body so
// each file holds a single component. Each dialog owns its visibility via `open`.
export function WorkspaceDialogs({
  project,
  projectId,
  state,
}: WorkspaceDialogsProps): React.JSX.Element {
  const navigate = useNavigate();
  const deleteProject = useDeleteProjectMutation(projectId);

  const onConfirmDelete = (): void => {
    deleteProject.mutate(undefined, {
      onSuccess: () => {
        toast.success("Project deleted.", { invert: true });
        state.setDeleteProjectOpen(false);
        void navigate({ to: "/project" });
      },
      onError: (error) =>
        toast.error(apiErrorMessage(error, "We couldn't delete the project.")),
    });
  };

  return (
    <>
      <AddKnowledgeDialog
        projectId={projectId}
        open={state.addKnowledgeOpen}
        onOpenChange={state.setAddKnowledgeOpen}
      />
      <EditProjectDialog
        project={project}
        open={state.editProjectOpen}
        onOpenChange={state.setEditProjectOpen}
      />
      <ConfirmDialog
        open={state.deleteProjectOpen}
        onOpenChange={state.setDeleteProjectOpen}
        title="Delete project"
        body={`Delete "${project.name}"? This removes the project and its digital workers, assets, and sandbox assignments. This can't be undone.`}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        pending={deleteProject.isPending}
        onConfirm={onConfirmDelete}
      />
      <InviteMemberDialog
        projectId={projectId}
        projectName={project.name}
        open={state.inviteHuman}
        onOpenChange={state.setInviteHuman}
      />
      <InviteDwDialog
        projectId={projectId}
        open={state.inviteDw}
        onOpenChange={state.setInviteDw}
      />
    </>
  );
}
