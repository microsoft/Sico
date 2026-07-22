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
