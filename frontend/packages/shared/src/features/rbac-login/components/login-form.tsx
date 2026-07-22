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

// `<LoginForm>` — RHF + zod resolver.
// Figma: https://www.figma.com/design/3vveHWaPfPnhzITDmstmJo/SICO.AI?node-id=12890-30278
import { Button, FieldError, FieldGroup } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { ArrowRight, Loader2 } from "lucide-react";
import type { JSX } from "react";

import { EmailField } from "./email-field";
import { PasswordField } from "./password-field";
import {
  type LoginMode,
  useLoginMode,
} from "../../../components/shell/login-mode-context";
import type { LoginResponse } from "../../../schemas/auth";
import { useExitSwap } from "../hooks/use-exit-swap";
import { useLoginForm } from "../hooks/use-login-form";

// Re-export so the `@sico/shared` public API keeps `LoginMode` at its existing
// path (the type now lives in the shell's login-mode-context).
export type { LoginMode };

const MODE_COPY: Record<
  LoginMode,
  {
    readonly title: string;
    readonly subtitle: string;
    readonly switchTo: string;
  }
> = {
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
};

export function LoginForm({ onSuccess }: LoginFormProps): JSX.Element {
  // Shared with `<LoginLayout>` so the header logo cross-fades in sync; falls
  // back to local state if no layout wraps this form.
  const [mode, setMode] = useLoginMode();
  // The form shows `displayedMode`, which trails `mode` through one exit
  // animation on a toggle (exit → swap → entrance). The header logo (keyed on
  // `mode`) cross-fades independently and instantly.
  const { displayedMode, exiting, sync } = useExitSwap(mode);
  const copy = MODE_COPY[displayedMode];

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
    <div className="flex flex-col gap-12">
      <form
        noValidate
        // Keyed on `displayedMode` (not `mode`): the re-mount — and thus the
        // staggered entrance — fires only AFTER the exit completes and the two
        // sync, so a toggle reads as exit → swap → enter (dwp's mode="wait").
        key={displayedMode}
        // While `exiting`, the whole form lifts+fades out; `onAnimationEnd`
        // (guarded to the form's own animation) then syncs `displayedMode` so
        // the fresh mount plays the entrance.
        className={cn(
          "flex w-90 flex-col gap-8",
          exiting && "motion-safe:animate-login-exit",
        )}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && exiting) {
            sync();
          }
        }}
        onSubmit={onSubmit}
      >
        <div className="flex flex-col gap-3">
          <h1
            className="text-foreground-primary motion-safe:animate-login-entrance text-3xl leading-tight font-medium"
            style={{ animationDelay: "50ms" }}
          >
            {copy.title}
          </h1>
          <p
            className="text-foreground-secondary motion-safe:animate-login-entrance text-base leading-normal"
            style={{ animationDelay: "110ms" }}
          >
            {copy.subtitle}
          </p>
        </div>

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
      </form>

      <button
        type="button"
        onClick={() =>
          setMode((m) => (m === "operator" ? "developer" : "operator"))
        }
        className="text-foreground-tertiary hover:text-foreground-secondary inline-flex items-center justify-center gap-1 self-center text-sm"
      >
        {copy.switchTo}
        <ArrowRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
