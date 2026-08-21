// `<LoginForm>` — RHF + zod resolver.
// Figma: https://www.figma.com/design/3vveHWaPfPnhzITDmstmJo/SICO.AI?node-id=12890-30278
import { Button, FieldError, FieldGroup } from "@sico/ui";
import { Loader2 } from "lucide-react";
import type { JSX } from "react";

import { AuthFormShell, type AuthModeCopy } from "./auth-form-shell";
import { AuthPrompt } from "./auth-prompt";
import { EmailField } from "./email-field";
import { PasswordField } from "./password-field";
import type { LoginMode } from "../../../components/shell/login-mode-context";
import { useLoginMode } from "../../../components/shell/login-mode-context";
import type { LoginResponse } from "../../../schemas/auth";
import { useLoginForm } from "../hooks/use-login-form";

// Re-export so the `@sico/shared` public API keeps `LoginMode` at its existing
// path (the type now lives in the shell's login-mode-context).
export type { LoginMode };

const MODE_COPY: Record<LoginMode, AuthModeCopy> = {
  operator: {
    title: "Sign in",
    subtitle: "Your Digital Workforce Platform.",
    switchTo: "Go to SICO.Dev",
  },
  developer: {
    title: "Welcome to SICO.Dev",
    subtitle: "Build and manage Digital Workers.",
    switchTo: "Go to SICO",
  },
};

export type LoginFormProps = {
  // `mode` lets the caller route by destination (operator → workspace,
  // developer → studio).
  readonly onSuccess: (data: LoginResponse, mode: LoginMode) => void;
  readonly onRegister?: (mode: LoginMode) => void;
};

export function LoginForm({
  onSuccess,
  onRegister,
}: LoginFormProps): JSX.Element {
  const [mode, setMode] = useLoginMode();
  const {
    control,
    onSubmit,
    isPending,
    credentialsError,
    networkError,
    triggerOnBlurIfFilled,
    clearCredentialsError,
  } = useLoginForm(mode, onSuccess);
  const hasCredentialsError = Boolean(credentialsError);

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
              hasCredentialsError={hasCredentialsError}
              triggerOnBlurIfFilled={triggerOnBlurIfFilled}
              clearCredentialsError={clearCredentialsError}
            />
            <PasswordField
              control={control}
              hasCredentialsError={hasCredentialsError}
              triggerOnBlurIfFilled={triggerOnBlurIfFilled}
              clearCredentialsError={clearCredentialsError}
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
              {isPending ? <Loader2 className="animate-spin" /> : null}
              Continue
            </Button>
            {credentialsError ? (
              <FieldError>{credentialsError}</FieldError>
            ) : null}
            {networkError ? <FieldError>{networkError}</FieldError> : null}
          </FieldGroup>
          {onRegister ? (
            <AuthPrompt
              question="Don't have an account?"
              action="Sign up"
              onClick={() => onRegister(displayedMode)}
            />
          ) : null}
        </>
      )}
    </AuthFormShell>
  );
}
