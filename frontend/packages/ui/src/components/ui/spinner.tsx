import { cva, type VariantProps } from "class-variance-authority";
import Lottie from "lottie-react";
import type { ComponentProps, ReactElement } from "react";

import animationData from "../../assets/loading.json";
import { cn } from "../../lib/utils";

/**
 * Loading indicator — bespoke SICO component (no shadcn upstream). Renders the
 * legacy four-dot comet animation 1:1 via Lottie, ported from the old repo's
 * `loading.json`. Colors are baked into the JSON, aligned to the SICO `primary`
 * scale (600/400/300/200).
 *
 * Two locked sizes via the `size` variant: `default` (40px) for inline /
 * route-level loading, `lg` (64px) for full-page fallbacks where 40px reads
 * as too small against the viewport. The variant class is appended after
 * `className` so size stays locked — `className` is for layout (margins,
 * positioning) only. `role` and `aria-label` stay overridable via spread
 * (callers pass `aria-label="Loading more"` on infinite-scroll footers).
 */

const spinnerVariants = cva("inline-block", {
  variants: {
    size: {
      default: "size-10",
      lg: "size-16",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

type SpinnerProps = ComponentProps<"div"> &
  VariantProps<typeof spinnerVariants>;

function Spinner({ className, size, ...props }: SpinnerProps): ReactElement {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(className, spinnerVariants({ size }))}
      {...props}
    >
      <Lottie
        animationData={animationData}
        loop
        autoplay
        className="size-full"
        aria-hidden="true"
      />
    </div>
  );
}

export { Spinner };
