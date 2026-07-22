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
