// Shared cross-link under the auth form ("Don't have an account? Sign up" /
// "Already have an account? Sign in"). Login and register differ only in copy
// and the click target, so the markup lives here once.
import { Button } from "@sico/ui";
import type { JSX } from "react";

export type AuthPromptProps = {
  readonly question: string;
  readonly action: string;
  readonly onClick: () => void;
};

export function AuthPrompt({
  question,
  action,
  onClick,
}: AuthPromptProps): JSX.Element {
  return (
    <p className="text-foreground-tertiary inline-flex items-center gap-3 text-sm">
      {question}
      <Button
        type="button"
        variant="link"
        onClick={onClick}
        className="p-0 underline"
      >
        {action}
      </Button>
    </p>
  );
}
