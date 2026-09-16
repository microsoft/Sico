import { useLingui } from "@lingui/react/macro";
import { Field, FieldError, FieldLabel, Input } from "@sico/ui";
import type { JSX } from "react";
import { type Control, Controller } from "react-hook-form";

import type { OrganizationUpdate } from "../services/organization";

export function OrganizationNameField({
  control,
  disabled,
}: {
  control: Control<OrganizationUpdate>;
  disabled: boolean;
}): JSX.Element {
  const { t } = useLingui();
  return (
    <Controller
      name="name"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid ? true : undefined}>
          <FieldLabel
            htmlFor="edit-org-name"
            className="text-xs font-semibold tracking-wider uppercase"
          >
            {t({
              id: "organization.editName.label",
              message: "Organization name",
            })}
          </FieldLabel>
          <Input
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            id="edit-org-name"
            disabled={disabled}
            aria-invalid={fieldState.invalid ? true : undefined}
            placeholder={t({
              id: "organization.editName.placeholder",
              message: "Enter organization name",
            })}
          />
          {fieldState.error?.message ? (
            <FieldError>{fieldState.error.message}</FieldError>
          ) : null}
        </Field>
      )}
    />
  );
}
