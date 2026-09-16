import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  FieldGroup,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2 } from "lucide-react";
import type * as React from "react";

import { AddDwDialogHeader } from "./add-dw-dialog-header";
import { AvatarField } from "./avatar-field";
import { DwField } from "./dw-field";
import { NameField } from "./name-field";
import { ProjectField } from "./project-field";
import { userAtom } from "../../../atoms/auth-atom";
import { useAddDwForm } from "../../../hooks/use-add-dw-form";
import { createProjectDialogOpenAtom } from "../../projects/atoms/create-project-dialog-atom";
import { useProjectsInfiniteQueryNonSuspense } from "../../projects/hooks/use-projects-query";
import { useAgentInfosQuery } from "../../studio/hooks/use-agent-infos-query";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { PLATFORM_AGENT_INFOS_INTENT } from "../../studio/services/single-agents";
import { useAddDwSubmit } from "../hooks/use-add-dw-submit";
import { deriveState } from "../utils/load-state";

export type AddDwDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Controlled dialog to add a digital worker into a project: pick a project →
 * pick a DW (agent template; role carried from the template) → name it → pick an
 * avatar. Submit creates the instance directly under the project (projectId is a
 * required field on the create endpoint). RHF + zodResolver + `@sico/ui` `Field`.
 * Field markup lives in `add-dw-fields.tsx`. */
export function AddDwDialog({
  open,
  onOpenChange,
}: AddDwDialogProps): React.JSX.Element {
  const { t } = useLingui();
  const user = useAtomValue(userAtom);
  const navigate = useNavigate();
  const setCreateProjectOpen = useSetAtom(createProjectDialogOpenAtom);
  const projectsQuery = useProjectsInfiniteQueryNonSuspense({});
  const projects =
    projectsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const projectsState = deriveState(
    projectsQuery.isPending,
    projectsQuery.isError,
    projects.length,
  );
  const templatesQuery = useAgentInfosQuery(PLATFORM_AGENT_INFOS_INTENT);
  const templates = templatesQuery.data ?? [];
  const templatesState = deriveState(
    templatesQuery.isPending,
    templatesQuery.isError,
    templates.length,
  );
  const { onSubmit, isPending } = useAddDwSubmit(user?.email, templates, () =>
    onOpenChange(false),
  );
  const avatarForm = useAddDwForm({
    open,
    isPending,
    onOpenChange,
    onSubmit,
  });
  const { form } = avatarForm;
  const saveLabel = avatarForm.isSaving
    ? t({ id: "common.status.saving", message: "Saving…" })
    : t({ id: "common.action.save", message: "Save" });

  const handleCreateProject = (): void => {
    avatarForm.handleOpenChange(false);
    setCreateProjectOpen(true);
    void navigate({ to: "/project" });
  };

  const handlePick = (card: SingleAgentCard | undefined): void => {
    if (card && !form.getFieldState("name").isDirty) {
      form.setValue("name", card.name);
    }
  };

  return (
    <Dialog open={open} onOpenChange={avatarForm.handleOpenChange}>
      <DialogContent variant="content" className="w-150">
        <AddDwDialogHeader />
        <form noValidate onSubmit={avatarForm.handleSubmit}>
          <FieldGroup>
            <ProjectField
              control={form.control}
              projects={projects}
              state={projectsState}
              onCreate={handleCreateProject}
            />
            <DwField
              control={form.control}
              templates={templates}
              state={templatesState}
              onPick={handlePick}
            />
            <NameField control={form.control} />
            <AvatarField
              preset={avatarForm.preset}
              onSelectPreset={avatarForm.onSelectPreset}
              disabled={avatarForm.isSaving}
              uploading={avatarForm.isUploading}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="subtle"
              onClick={() => avatarForm.handleOpenChange(false)}
            >
              {t({ id: "common.action.cancel", message: "Cancel" })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={avatarForm.isSaving}
              disabled={avatarForm.isSaving}
            >
              {avatarForm.isSaving ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
