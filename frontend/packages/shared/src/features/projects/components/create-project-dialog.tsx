import { zodResolver } from "@hookform/resolvers/zod";
import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import type * as React from "react";
import { Controller, useForm } from "react-hook-form";

import { CoverField } from "./cover-field";
import { CreateProjectDescriptionField } from "./create-project-description-field";
import {
  CREATE_PROJECT_INITIAL_VALUES,
  createProjectSchema,
  type CreateProjectValues,
} from "./create-project-fields";
import { CreateProjectNameField } from "./create-project-name-field";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { useCreateProjectMutation } from "../hooks/use-create-project-mutation";

export type CreateProjectDialogProps = {
  organizationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Controlled dialog for creating a project. RHF + zodResolver + `@sico/ui`
 * `Field` primitives; structure mirrors `EditProjectDialog`. Fields: name,
 * description (char counter), and an eagerly-uploaded cover whose relative `uri`
 * becomes the project's `iconUri`. Field markup lives in
 * `create-project-fields.tsx`. */
export function CreateProjectDialog({
  organizationId,
  open,
  onOpenChange,
}: CreateProjectDialogProps): React.JSX.Element {
  const { t } = useLingui();
  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: CREATE_PROJECT_INITIAL_VALUES,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const mutation = useCreateProjectMutation();

  useEffect(() => {
    if (open) {
      form.reset(CREATE_PROJECT_INITIAL_VALUES);
    }
  }, [open, form]);

  const onSubmit = (values: CreateProjectValues): void => {
    mutation.mutate(
      {
        name: values.name,
        organizationId,
        description: values.description,
        iconUri: values.iconUri,
      },
      {
        onSuccess: () => {
          toast.success(
            t({
              id: "projects.createDialog.success",
              message: "Project created.",
            }),
            { invert: true },
          );
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(
              error,
              t({
                id: "projects.createDialog.error",
                message: "We couldn't create your project.",
              }),
            ),
          );
        },
      },
    );
  };

  const saveLabel = mutation.isPending
    ? t({ id: "common.status.saving", message: "Saving…" })
    : t({ id: "common.action.save", message: "Save" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>
            {t({
              id: "projects.createDialog.title",
              message: "Create Project",
            })}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <CreateProjectNameField control={form.control} />
            <CreateProjectDescriptionField control={form.control} />
            <Controller
              name="iconUri"
              control={form.control}
              render={({ field }) => (
                <CoverField value={field.value} onChange={field.onChange} />
              )}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="subtle"
              onClick={() => onOpenChange(false)}
            >
              {t({ id: "common.action.cancel", message: "Cancel" })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={mutation.isPending}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
