import { type ReactElement } from "react";
import type { FallbackProps } from "react-error-boundary";

import { InnerErrorFallback as InnerErrorFallbackImpl } from "./inner-error-fallback";
import {
  OuterErrorFallback as OuterErrorFallbackImpl,
  type OuterErrorFallbackProps,
} from "./outer-error-fallback";
import { assertNever } from "../../utils/assert-never";

export { InnerErrorFallbackImpl as InnerErrorFallback };
export { OuterErrorFallbackImpl as OuterErrorFallback };
export type { OuterErrorFallbackProps };

// Discriminated union: `variant="inner"` cannot accept `onReload`.
export type ErrorFallbackProps = FallbackProps &
  ({ variant: "inner" } | { variant: "outer"; onReload?: () => void });

/**
 * Canonical Storybook entry point — the args control drives `variant`,
 * which the two sibling exports cannot model. Runtime call sites should
 * import `<InnerErrorFallback>` / `<OuterErrorFallback>` directly.
 */
export function ErrorFallback(props: ErrorFallbackProps): ReactElement {
  // Props are kept un-destructured at the signature so each case can
  // pick the right shape — top-level destructuring would widen back to
  // the union.
  const { variant } = props;
  switch (variant) {
    case "outer": {
      const { error, onReload } = props;
      return <OuterErrorFallbackImpl error={error} onReload={onReload} />;
    }
    case "inner": {
      const { error, resetErrorBoundary } = props;
      return (
        <InnerErrorFallbackImpl
          error={error}
          resetErrorBoundary={resetErrorBoundary}
        />
      );
    }
    default:
      return assertNever(variant);
  }
}
