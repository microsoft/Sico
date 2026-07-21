import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement } from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // SICO Primary: dark fill, white text, shadow-s
        primary:
          "bg-button-primary-fill-rest text-button-primary-foreground-rest shadow-button-primary hover:bg-button-primary-fill-hover active:bg-button-primary-fill-pressed disabled:bg-button-primary-fill-disabled disabled:text-button-primary-foreground-disabled disabled:shadow-none",
        // SICO Secondary: white fill, border, shadow-s
        secondary:
          "border-button-secondary-stroke-rest bg-button-secondary-fill-rest text-button-secondary-foreground-rest shadow-button-secondary hover:bg-button-secondary-fill-hover hover:border-button-secondary-stroke-hover active:bg-button-secondary-fill-pressed active:border-button-secondary-stroke-pressed disabled:bg-button-secondary-fill-disabled disabled:border-button-secondary-stroke-disabled disabled:text-button-secondary-foreground-disabled disabled:shadow-none",
        // SICO Subtle: transparent, hover shows gray
        subtle:
          "bg-button-subtle-fill-rest text-button-subtle-foreground-rest hover:bg-button-subtle-fill-hover active:bg-button-subtle-fill-pressed disabled:bg-button-subtle-fill-disabled disabled:text-button-subtle-foreground-disabled",
        // SICO Destructive: transparent fill like subtle, red text
        destructive:
          "bg-button-destructive-fill-rest text-button-destructive-foreground-rest hover:bg-button-destructive-fill-hover hover:text-button-destructive-foreground-hover active:bg-button-destructive-fill-pressed active:text-button-destructive-foreground-pressed disabled:bg-button-destructive-fill-disabled disabled:text-button-destructive-foreground-disabled",
        // SICO Destructive Outline: white fill, red border, red text, shadow
        "destructive-outline":
          "border-button-destructive-outline-stroke-rest bg-button-destructive-outline-fill-rest text-button-destructive-outline-foreground-rest shadow-button-destructive-outline hover:bg-button-destructive-outline-fill-hover hover:border-button-destructive-outline-stroke-hover hover:text-button-destructive-outline-foreground-hover active:bg-button-destructive-outline-fill-pressed active:border-button-destructive-outline-stroke-pressed active:text-button-destructive-outline-foreground-pressed disabled:bg-button-destructive-outline-fill-disabled disabled:border-button-destructive-outline-stroke-disabled disabled:text-button-destructive-outline-foreground-disabled disabled:shadow-none",
        // Link (SICO semantic link tokens)
        link: "text-button-link-foreground-rest hover:text-button-link-foreground-hover active:text-button-link-foreground-pressed disabled:text-button-link-foreground-disabled h-6 focus-visible:border-transparent focus-visible:ring-0",
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
