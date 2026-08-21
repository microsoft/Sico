import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  FieldGroup,
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import type * as React from "react";
import { Controller, useForm } from "react-hook-form";

import { CoverField } from "./cover-field";
import {
  createProjectSchema,
  type CreateProjectValues,
  renderDescriptionField,
  renderNameField,
} from "./create-project-fields";
import { useProjectMutation } from "../hooks/use-project-mutation";
import type { ProjectDetail } from "../schemas/project";

export type EditProjectDialogProps = {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Controlled dialog for editing a project's name, description, and cover.
 * Mirrors `CreateProjectDialog`'s field markup (shared `create-project-fields`)
 * so the two forms stay visually identical.
 *
 * The form deliberately NEVER carries `operatorAdmins`: `PUT /project` runs
 * `syncProjectAdmins` unconditionally, so an omitted/empty operator list would
 * silently wipe every operator (§6 dec 6). `useProjectMutation` injects the
 * full cached operator set for this name/description/icon edit — members are
 * managed on the members page, not here.
 */
export function EditProjectDialog({
  project,
  open,
  onOpenChange,
}: EditProjectDialogProps): React.JSX.Element {
  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: project.name,
      description: project.description,
      iconUri: project.iconUrl,
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const mutation = useProjectMutation(project.id);

  useEffect(() => {
    if (open) {
      form.reset({
        name: project.name,
        description: project.description,
        iconUri: project.iconUrl,
      });
    }
    // Keyed on the project's field values (not the object) so re-seeding only
    // happens on open / when the underlying project data actually changes —
    // keying on the object would clobber in-progress edits if the parent
    // re-creates `project` each render.
  }, [open, project.name, project.description, project.iconUrl, form]);

  const onSubmit = (values: CreateProjectValues): void => {
    // The cover field is seeded with the project's current `iconUrl` (an
    // absolute CDN URL) purely for display. The backend expects `iconUri` to be
    // a RELATIVE upload uri, so echoing the absolute URL back on an unchanged
    // cover makes it reject/blank the icon. Only send `iconUri` when the user
    // actually picked a NEW cover (the value diverged from the seeded one);
    // otherwise omit it so the backend keeps the existing cover.
    const iconChanged = values.iconUri !== project.iconUrl;
    mutation.mutate(
      {
        name: values.name,
        description: values.description,
        ...(iconChanged ? { iconUri: values.iconUri } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Your changes are saved.", { invert: true });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
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
            {mutation.isError && (
              <FieldError>
                We couldn&apos;t save your changes. Try again.
              </FieldError>
            )}
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
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
