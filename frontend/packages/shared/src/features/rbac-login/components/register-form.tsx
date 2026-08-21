// `<RegisterForm>` — dual-mode registration with shared credential fields.
// Figma: https://www.figma.com/design/3vveHWaPfPnhzITDmstmJo/SICO.AI?node-id=12890-30392
import { Button, FieldError, FieldGroup } from "@sico/ui";
import type { JSX } from "react";

import { AuthFormShell, type AuthModeCopy } from "./auth-form-shell";
import { AuthPrompt } from "./auth-prompt";
import { EmailField } from "./email-field";
import { PasswordField } from "./password-field";
import {
  type LoginMode,
  useLoginMode,
} from "../../../components/shell/login-mode-context";
import type { RegisterNewUserResponse } from "../../../schemas/auth";
import { useRegisterForm } from "../hooks/use-register-form";

const MODE_COPY: Record<LoginMode, AuthModeCopy> = {
  operator: {
    title: "Sign up",
    subtitle: "Your Digital Workforce Platform.",
    switchTo: "Go to SICO.Dev",
  },
  developer: {
    title: "Welcome to SICO.Dev",
    subtitle: "Build and manage Digital Workers.",
    switchTo: "Go to SICO",
  },
};

export type RegisterFormProps = {
  readonly onSuccess: (data: RegisterNewUserResponse, mode: LoginMode) => void;
  readonly onLogin: (mode: LoginMode) => void;
};

export function RegisterForm({
  onSuccess,
  onLogin,
}: RegisterFormProps): JSX.Element {
  const [mode, setMode] = useLoginMode();
  const {
    control,
    onSubmit,
    isPending,
    registrationError,
    networkError,
    triggerOnBlurIfFilled,
    clearFormErrors,
  } = useRegisterForm(mode, onSuccess);

  return (
    <AuthFormShell
      copy={MODE_COPY}
      mode={mode}
      setMode={setMode}
      onSubmit={onSubmit}
    >
      {(displayedMode) => (
        <>
          <FieldGroup
            className="motion-safe:animate-login-entrance gap-8"
            style={{ animationDelay: "170ms" }}
          >
            <EmailField
              control={control}
              hasCredentialsError={Boolean(registrationError)}
              triggerOnBlurIfFilled={triggerOnBlurIfFilled}
              clearCredentialsError={clearFormErrors}
              idPrefix="register"
            />
            <PasswordField
              control={control}
              hasCredentialsError={Boolean(registrationError)}
              triggerOnBlurIfFilled={triggerOnBlurIfFilled}
              clearCredentialsError={clearFormErrors}
              idPrefix="register"
              passwordPlaceholder="Create password"
              passwordAutoComplete="new-password"
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="motion-safe:animate-login-entrance w-full"
              style={{ animationDelay: "230ms" }}
              disabled={isPending}
              aria-busy={isPending}
            >
              Create Account
            </Button>
            {registrationError ? (
              <FieldError>{registrationError}</FieldError>
            ) : null}
            {networkError ? <FieldError>{networkError}</FieldError> : null}
          </FieldGroup>
          <AuthPrompt
            question="Already have an account?"
            action="Sign in"
            onClick={() => onLogin(displayedMode)}
          />
        </>
      )}
    </AuthFormShell>
  );
}
