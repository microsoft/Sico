// Shared scaffold for the dual-mode auth forms. Owns the exit→swap animation
// cycle, the keyed form wrapper, the heading/subtitle block, and the
// self-centered mode-switch button. The caller owns the mode state (a single
// `useLoginMode` per form) and passes it in, so shell and form never fork into
// two independent mode copies when no `LoginLayout` provider wraps them.
import { Button } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { ArrowRight } from "lucide-react";
import type {
  Dispatch,
  FormEventHandler,
  JSX,
  ReactNode,
  SetStateAction,
} from "react";

import type { LoginMode } from "../../../components/shell/login-mode-context";
import { useExitSwap } from "../hooks/use-exit-swap";

export type AuthModeCopy = {
  readonly title: string;
  readonly subtitle: string;
  readonly switchTo: string;
};

export type AuthFormShellProps = {
  readonly mode: LoginMode;
  readonly setMode: Dispatch<SetStateAction<LoginMode>>;
  readonly copy: Record<LoginMode, AuthModeCopy>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly children: (displayedMode: LoginMode) => ReactNode;
};

export function AuthFormShell({
  mode,
  setMode,
  copy,
  onSubmit,
  children,
}: AuthFormShellProps): JSX.Element {
  // The form shows `displayedMode`, which trails `mode` through one exit
  // animation on a toggle (exit → swap → entrance). The header logo (keyed on
  // `mode`) cross-fades independently and instantly.
  const { displayedMode, exiting, sync } = useExitSwap(mode);
  const modeCopy = copy[displayedMode];

  return (
    <div className="flex flex-col gap-20">
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
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && exiting) {
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
            {modeCopy.title}
          </h1>
          <p
            className="text-foreground-secondary motion-safe:animate-login-entrance text-base leading-normal"
            style={{ animationDelay: "110ms" }}
          >
            {modeCopy.subtitle}
          </p>
        </div>

        {children(displayedMode)}
      </form>

      <Button
        type="button"
        variant="link"
        onClick={() =>
          setMode((current) =>
            current === "operator" ? "developer" : "operator",
          )
        }
        className="text-foreground-secondary hover:text-foreground-primary active:text-foreground-primary"
      >
        {modeCopy.switchTo}
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}
