import { zodResolver } from "@hookform/resolvers/zod";
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

import {
  CoverField,
  CREATE_PROJECT_INITIAL_VALUES,
  createProjectSchema,
  type CreateProjectValues,
  renderDescriptionField,
  renderNameField,
} from "./create-project-fields";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { useCreateProjectMutation } from "../hooks/use-create-project-mutation";

export type CreateProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Controlled dialog for creating a project. RHF + zodResolver + `@sico/ui`
 * `Field` primitives; structure mirrors `EditProjectDialog`. Fields: name,
 * description (char counter), and an eagerly-uploaded cover whose relative `uri`
 * becomes the project's `iconUri`. Field markup lives in
 * `create-project-fields.tsx`. */
export function CreateProjectDialog({
  open,
  onOpenChange,
}: CreateProjectDialogProps): React.JSX.Element {
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
        description: values.description,
        iconUri: values.iconUri,
      },
      {
        onSuccess: () => {
          toast.success("Project created.", { invert: true });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(error, "We couldn't create your project."),
          );
        },
      },
    );
  };

  const saveLabel = mutation.isPending ? "Saving…" : "Save";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {renderNameField(form.control)}
            {renderDescriptionField(form.control)}
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
              Cancel
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
