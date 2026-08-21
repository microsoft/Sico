import { Field, FieldError, FieldLabel, Input } from "@sico/ui";
import type * as React from "react";
import { type Control, Controller } from "react-hook-form";
import { z } from "zod";

import { CharCountTextarea } from "../../../components/char-count-textarea";
import { FIELD_LABEL_CLASS } from "../../../constants/form";

const MAX_NAME_LENGTH = 20;
export const MAX_DESCRIPTION_LENGTH = 200;

// Backend caps name at ≤100. Description is capped at 200 characters
// (client-only, matching the design). A character cap (not word count) is used
// so the limit is meaningful for CJK text, which has no inter-word spaces.
// `iconUri` holds the eagerly-uploaded cover's relative `uri`.
export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(MAX_NAME_LENGTH, "Name is too long"),
  description: z
    .string()
    .max(
      MAX_DESCRIPTION_LENGTH,
      `Description must be ${String(MAX_DESCRIPTION_LENGTH)} characters or fewer`,
    ),
  iconUri: z.string().optional(),
});
export type CreateProjectValues = z.infer<typeof createProjectSchema>;

export const CREATE_PROJECT_INITIAL_VALUES: CreateProjectValues = {
  name: "",
  description: "",
  iconUri: undefined,
};

export function renderNameField(
  control: Control<CreateProjectValues>,
): React.JSX.Element {
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel
            htmlFor="create-project-name"
            className={FIELD_LABEL_CLASS}
          >
            Name
          </FieldLabel>
          <Input
            id="create-project-name"
            placeholder="e.g. Aurora launch"
            maxLength={MAX_NAME_LENGTH}
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

export function renderDescriptionField(
  control: Control<CreateProjectValues>,
): React.JSX.Element {
  return (
    <Controller
      name="description"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel
            htmlFor="create-project-description"
            className={FIELD_LABEL_CLASS}
          >
            Description
          </FieldLabel>
          <CharCountTextarea
            id="create-project-description"
            placeholder="What is this project trying to do? Who is it for?"
            ariaInvalid={fieldState.invalid ? true : undefined}
            max={MAX_DESCRIPTION_LENGTH}
            // Fixed height — override the base `field-sizing-content` so the
            // dialog layout stays stable; overflow scrolls internally.
            className="[field-sizing:fixed] h-30 resize-none"
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
