// `<EmailField>` — email Controller for `<LoginForm>`.
import { Field, FieldError, FieldLabel, Input } from "@sico/ui";
import type { JSX } from "react";
import { Controller } from "react-hook-form";

import type { CredentialFieldProps } from "./credential-field-props";

export function EmailField({
  control,
  hasCredentialsError,
  triggerOnBlurIfFilled,
  clearCredentialsError,
}: CredentialFieldProps): JSX.Element {
  return (
    <Controller
      name="email"
      control={control}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={
            fieldState.invalid || hasCredentialsError ? true : undefined
          }
        >
          <FieldLabel htmlFor="login-email">Email Address*</FieldLabel>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="Must be a Microsoft email"
            aria-invalid={
              fieldState.invalid || hasCredentialsError ? true : undefined
            }
            name={field.name}
            ref={field.ref}
            value={field.value}
            onBlur={() => {
              field.onBlur();
              triggerOnBlurIfFilled("email");
            }}
            onChange={(event) => {
              field.onChange(event);
              clearCredentialsError();
            }}
          />
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}
