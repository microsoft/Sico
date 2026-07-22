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

// `<PasswordField>` — password Controller for `<LoginForm>`, with a local
// visibility toggle + Caps Lock hint.
import {
  Field,
  FieldError,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@sico/ui";
import { Eye, EyeOff } from "lucide-react";
import { type JSX, type KeyboardEvent, useState } from "react";
import { Controller } from "react-hook-form";

import type { CredentialFieldProps } from "./credential-field-props";

export function PasswordField({
  control,
  hasCredentialsError,
  triggerOnBlurIfFilled,
  clearCredentialsError,
}: CredentialFieldProps): JSX.Element {
  // Visibility toggle + Caps Lock hint are local to this field only.
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  // `onKeyUp` (not `onChange`) so the event carries `getModifierState`.
  const handlePasswordKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    setCapsOn(event.getModifierState("CapsLock"));
  };
  const passwordToggleLabel = showPassword ? "Hide password" : "Show password";

  return (
    <Controller
      name="password"
      control={control}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={
            fieldState.invalid || hasCredentialsError ? true : undefined
          }
        >
          <FieldLabel htmlFor="login-password">Password*</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              aria-invalid={
                fieldState.invalid || hasCredentialsError ? true : undefined
              }
              name={field.name}
              ref={field.ref}
              value={field.value}
              onBlur={() => {
                field.onBlur();
                triggerOnBlurIfFilled("password");
              }}
              onChange={(event) => {
                field.onChange(event);
                clearCredentialsError();
              }}
              onKeyUp={handlePasswordKey}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={passwordToggleLabel}
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" />
                ) : (
                  <Eye aria-hidden="true" />
                )}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {capsOn && (
            <p className="text-foreground-tertiary text-sm">Caps Lock is on</p>
          )}
          {fieldState.error?.message && (
            <FieldError>{fieldState.error.message}</FieldError>
          )}
        </Field>
      )}
    />
  );
}
