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
