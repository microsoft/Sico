import type * as React from "react";

import { cn } from "../../lib/utils";

// shadcn default uses `bg-muted` + `animate-pulse`. Replaced with a shimmer
// sweep: the `skeleton` utility lays a translucent overlay-wash highlight band
// over a `surface-muted` base, scrolled via background-position by
// `animate-skeleton`. animate-pulse only animates opacity, invisible on
// near-white surfaces. Same shimmer engine + skin pattern as `shiny-text`.
function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "skeleton animate-skeleton bg-surface-muted rounded-xl",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
