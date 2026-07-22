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

import { type ReactElement, type ReactNode, useEffect } from "react";

import { logger } from "../../utils/logger";

// Shared chrome for both ErrorFallback variants: `role="alert"`,
// one-shot logger side-effect, and the title/body/action slots. The
// visual chrome (positioning, palette) is owned by each variant.
//
// Footgun: do NOT throw or mutate `error.message` here — a new throw
// would re-trigger the outer boundary and cause a render loop.
type ErrorFallbackChromeProps = {
  // `FallbackProps.error` is `unknown`; the chrome just hands it to the
  // logger (which accepts unknown context), so no narrowing required.
  error: unknown;
  variant: "inner" | "outer";
  title: ReactNode;
  titleAs: "h1" | "h2";
  body: ReactNode;
  action: ReactNode;
  containerClassName: string;
  titleClassName: string;
  bodyClassName: string;
};

export function ErrorFallbackChrome({
  error,
  variant,
  title,
  titleAs,
  body,
  action,
  containerClassName,
  titleClassName,
  bodyClassName,
}: ErrorFallbackChromeProps): ReactElement {
  useEffect(() => {
    logger.error("ErrorFallback caught", { error, variant });
  }, [error, variant]);

  const Heading = titleAs;
  return (
    <div role="alert" className={containerClassName}>
      <Heading className={titleClassName}>{title}</Heading>
      <p className={bodyClassName}>{body}</p>
      {action}
    </div>
  );
}
