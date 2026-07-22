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

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import type * as React from "react";
import { type Control, Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { OperatorAdder } from "./operator-adder";
import { safeIconUri } from "../../../utils/safe-icon-uri";
import { useProjectMutation } from "../hooks/use-project-mutation";
import type { ProjectDetail } from "../schemas/project";

const editProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string(),
  iconUri: z.string(),
});
type EditProjectValues = z.infer<typeof editProjectSchema>;

// Render helpers — plain module-scope functions (NOT nested components, so
// `react/no-unstable-nested-components` never fires) that keep the dialog body
// under the 100-line cap. RHF `field` is wired prop-by-prop, mirroring
// `email-field.tsx`, because `react/jsx-props-no-spreading` forbids `{...field}`.

function renderNameField(
  control: Control<EditProjectValues>,
): React.JSX.Element {
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="edit-project-name" className="text-base">
            Name
          </FieldLabel>
          <Input
            id="edit-project-name"
            aria-invalid={fieldState.invalid ? true : undefined}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

function renderDescriptionField(
  control: Control<EditProjectValues>,
): React.JSX.Element {
  return (
    <Controller
      name="description"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="edit-project-description" className="text-base">
            Description
          </FieldLabel>
          <Textarea
            id="edit-project-description"
            aria-invalid={fieldState.invalid ? true : undefined}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

function renderIconField(
  control: Control<EditProjectValues>,
  preview: string | undefined,
): React.JSX.Element {
  return (
    <Controller
      name="iconUri"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="edit-project-icon" className="text-base">
            Icon
          </FieldLabel>
          <div className="flex items-center gap-3">
            {preview ? (
              <img src={preview} alt="" className="size-10 rounded-md" />
            ) : null}
            <Input
              id="edit-project-icon"
              aria-invalid={fieldState.invalid ? true : undefined}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          </div>
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}

export type EditProjectDialogProps = {
  project: ProjectDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Controlled dialog for editing a project's name, description, and icon.
 *
 * The form deliberately NEVER carries `operatorAdmins`: `PUT /project` runs
 * `syncProjectAdmins` unconditionally, so an omitted/empty operator list would
 * silently wipe every operator (§6 dec 6). `useProjectMutation` injects the
 * full cached operator set for a name/description/icon edit; only the explicit
 * operator-add control computes and passes the next full `operatorAdmins` set.
 */
export function EditProjectDialog({
  project,
  open,
  onOpenChange,
}: EditProjectDialogProps): React.JSX.Element {
  const form = useForm<EditProjectValues>({
    resolver: zodResolver(editProjectSchema),
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

  const onSubmit = (values: EditProjectValues): void => {
    mutation.mutate(
      {
        name: values.name,
        description: values.description,
        iconUri: values.iconUri,
      },
      {
        // Success was previously silent (no toast, dialog stayed open). Failure
        // already surfaces inline via `mutation.isError` below.
        onSuccess: () => {
          toast.success("Your changes are saved.", { invert: true });
          onOpenChange(false);
        },
      },
    );
  };

  // Operator add/remove is the ONE path that sends operatorAdmins explicitly
  // (a name/description/icon edit must NOT — the hook injects the cached set).
  // Residual race: the hook invalidates and the parent refetches asynchronously,
  // so a second add fired before the refreshed project lands would compute from a
  // briefly-stale set. Acceptable for this provisional OQ-B-blocked control;
  // revisit when OQ-B finalizes the operator identifier.
  const handleAddOperators = (operators: string[]): void => {
    mutation.mutate({ operatorAdmins: operators });
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
            {renderIconField(form.control, safeIconUri(project.iconUrl))}
            <OperatorAdder
              key={String(open)}
              existingOperators={project.operatorAdmins}
              pending={mutation.isPending}
              onAdd={handleAddOperators}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            {mutation.isError && (
              <FieldError>
                We couldn&apos;t save your changes. Try again.
              </FieldError>
            )}
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
