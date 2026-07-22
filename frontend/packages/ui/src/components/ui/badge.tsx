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
import type { HTMLAttributes, ReactElement } from "react";

import { cn } from "../../lib/utils";

/**
 * Badge — shadcn base-nova restyle, with documented SICO deletions
 * (see the MDX Upstream Audit). Narrows `variant` to default|secondary, adds a
 * `color` prop driving the SICO Status token map, and drops the Base UI
 * `render`/useRender polymorphism plus the interactive primitives
 * (focus-visible, aria-invalid, transition, icon sizing/gap).
 *
 * Two variants:
 * - "default": filled pill with tinted background
 * - "secondary": subtle text-only (pair with a dot child for status indicators)
 *
 * Five semantic colors: green, red, orange, blue, gray.
 * Dot indicators are consumer-composed as children, not baked in.
 */

const badgeColorClasses = {
  green: {
    default: "bg-status-success-fill text-status-success-on-fill-foreground",
    secondary: "text-status-success-foreground",
  },
  red: {
    default: "bg-status-error-fill text-status-error-on-fill-foreground",
    secondary: "text-status-error-foreground",
  },
  orange: {
    default: "bg-status-warning-fill text-status-warning-foreground",
    secondary: "text-status-warning-foreground",
  },
  blue: {
    default: "bg-status-info-fill text-status-info-on-fill-foreground",
    secondary: "text-status-info-foreground",
  },
  gray: {
    default: "bg-surface-sunken text-foreground-secondary",
    secondary: "text-foreground-tertiary",
  },
} as const;

type BadgeColor = keyof typeof badgeColorClasses;

const badgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center text-xs leading-body font-medium tracking-wider whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "h-6 gap-1.5 rounded-sm px-2 py-1",
        secondary: "h-5 gap-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    color?: BadgeColor;
  };

function Badge({
  className,
  variant = "default",
  color = "green",
  children,
  ...props
}: BadgeProps): ReactElement {
  return (
    <span
      data-slot="badge"
      className={cn(
        badgeVariants({ variant }),
        badgeColorClasses[color][variant ?? "default"],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
export type { BadgeColor };
