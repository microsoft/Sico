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

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement } from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // SICO Primary: dark fill, white text, shadow-s
        primary:
          "bg-button-primary-fill-rest text-button-primary-foreground-rest shadow-button-primary hover:bg-button-primary-fill-hover active:bg-button-primary-fill-pressed disabled:bg-button-primary-fill-disabled disabled:text-button-primary-foreground-disabled disabled:shadow-none",
        // SICO Secondary: white fill, border, shadow-s
        secondary:
          "border-button-secondary-stroke-rest bg-button-secondary-fill-rest text-button-secondary-foreground-rest shadow-button-secondary hover:border-button-secondary-stroke-hover hover:bg-button-secondary-fill-hover active:border-button-secondary-stroke-pressed active:bg-button-secondary-fill-pressed disabled:border-button-secondary-stroke-disabled disabled:bg-button-secondary-fill-disabled disabled:text-button-secondary-foreground-disabled disabled:shadow-none",
        // SICO Subtle: transparent, hover shows gray
        subtle:
          "bg-button-subtle-fill-rest text-button-subtle-foreground-rest hover:bg-button-subtle-fill-hover active:bg-button-subtle-fill-pressed disabled:bg-button-subtle-fill-disabled disabled:text-button-subtle-foreground-disabled",
        // SICO Destructive: transparent fill like subtle, red text
        destructive:
          "bg-button-destructive-fill-rest text-button-destructive-foreground-rest hover:bg-button-destructive-fill-hover hover:text-button-destructive-foreground-hover active:bg-button-destructive-fill-pressed active:text-button-destructive-foreground-pressed disabled:bg-button-destructive-fill-disabled disabled:text-button-destructive-foreground-disabled",
        // SICO Destructive Outline: white fill, red border, red text, shadow
        "destructive-outline":
          "border-button-destructive-outline-stroke-rest bg-button-destructive-outline-fill-rest text-button-destructive-outline-foreground-rest shadow-button-destructive-outline hover:border-button-destructive-outline-stroke-hover hover:bg-button-destructive-outline-fill-hover hover:text-button-destructive-outline-foreground-hover active:border-button-destructive-outline-stroke-pressed active:bg-button-destructive-outline-fill-pressed active:text-button-destructive-outline-foreground-pressed disabled:border-button-destructive-outline-stroke-disabled disabled:bg-button-destructive-outline-fill-disabled disabled:text-button-destructive-outline-foreground-disabled disabled:shadow-none",
        // Link (SICO semantic link tokens)
        link: "h-6 text-button-link-foreground-rest hover:text-button-link-foreground-hover focus-visible:border-transparent focus-visible:ring-0 active:text-button-link-foreground-pressed disabled:text-button-link-foreground-disabled",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        sm: "h-7 gap-1 rounded-md px-2.5 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-sm": "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function Button({
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonProps): ReactElement {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
