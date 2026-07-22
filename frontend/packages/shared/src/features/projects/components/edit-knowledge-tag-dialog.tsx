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
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { useLayoutEffect } from "react";
import type * as React from "react";
import { type Control, Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { CharCountInput } from "../../../components/char-count-input";
import { CharCountTextarea } from "../../../components/char-count-textarea";
import { useKnowledgeTagMutation } from "../hooks/use-knowledge-tag-mutation";
import type { KnowledgeTag } from "../schemas/knowledge-tag";

const NAME_MAX = 20;
const WHEN_TO_USE_MAX = 100;

// `whenToUse` maps to the domain `description` at submit. Inputs hard-cap via
// `maxLength`; zod `.max()` backstops pre-seeded over-limit Edit values.
const editKnowledgeTagFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(NAME_MAX, "Name is too long"),
  whenToUse: z.string().max(WHEN_TO_USE_MAX, "When to use is too long"),
});
type EditKnowledgeTagFormValues = z.infer<typeof editKnowledgeTagFormSchema>;

// Module-scope helpers + prop-by-prop wiring satisfy no-unstable-nested-
// components / jsx-props-no-spreading.
function renderNameField(
  control: Control<EditKnowledgeTagFormValues>,
): React.JSX.Element {
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel htmlFor="edit-knowledge-tag-name" className="text-base">
            Name
          </FieldLabel>
          <CharCountInput
            id="edit-knowledge-tag-name"
            placeholder="Name this knowledge tag"
            autoComplete="off"
            max={NAME_MAX}
            ariaInvalid={fieldState.invalid ? true : undefined}
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

function renderWhenToUseField(
  control: Control<EditKnowledgeTagFormValues>,
): React.JSX.Element {
  return (
    <Controller
      name="whenToUse"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel
            htmlFor="edit-knowledge-tag-when-to-use"
            className="text-base"
          >
            When to use
          </FieldLabel>
          <CharCountTextarea
            id="edit-knowledge-tag-when-to-use"
            className="min-h-48"
            placeholder="Describe when your digital workers should use this tag."
            autoComplete="off"
            max={WHEN_TO_USE_MAX}
            ariaInvalid={fieldState.invalid ? true : undefined}
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

export type EditKnowledgeTagDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** Present → Edit an existing knowledge tag; omitted → Add a new one. */
  knowledgeTag?: KnowledgeTag;
};

/** Controlled Add/Edit dialog — `knowledgeTag` decides the mode. */
export function EditKnowledgeTagDialog({
  open,
  onOpenChange,
  projectId,
  knowledgeTag,
}: EditKnowledgeTagDialogProps): React.JSX.Element {
  const form = useForm<EditKnowledgeTagFormValues>({
    resolver: zodResolver(editKnowledgeTagFormSchema),
    defaultValues: {
      name: knowledgeTag?.name ?? "",
      whenToUse: knowledgeTag?.description ?? "",
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const { create, edit } = useKnowledgeTagMutation(projectId);
  const pending = knowledgeTag ? edit.isPending : create.isPending;

  // Re-seed on open, keyed on the tag's fields (not the object) so a re-created
  // prop can't clobber an edit. `useLayoutEffect` runs before paint so the
  // persistently-mounted dialog never flashes the previous open's values.
  useLayoutEffect(() => {
    if (open) {
      form.reset({
        name: knowledgeTag?.name ?? "",
        whenToUse: knowledgeTag?.description ?? "",
      });
    }
  }, [
    open,
    knowledgeTag?.id,
    knowledgeTag?.name,
    knowledgeTag?.description,
    form,
  ]);

  const onSubmit = (values: EditKnowledgeTagFormValues): void => {
    const onSuccess = (): void => {
      toast.success("Knowledge tag saved.", { invert: true });
      onOpenChange(false);
    };
    // Keep the dialog open on failure so input survives for a retry.
    const onError = (): void => {
      toast.error("We couldn't save your changes. Try again.");
    };
    if (knowledgeTag) {
      edit.mutate(
        {
          id: knowledgeTag.id,
          name: values.name,
          description: values.whenToUse,
        },
        { onSuccess, onError },
      );
    } else {
      create.mutate(
        { projectId, name: values.name, description: values.whenToUse },
        { onSuccess, onError },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>
            {knowledgeTag ? "Edit knowledge tag" : "Add knowledge tag"}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {renderNameField(form.control)}
            {renderWhenToUseField(form.control)}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={pending}
              disabled={pending}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
