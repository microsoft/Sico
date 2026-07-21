import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactElement } from "react";

import { cn } from "../../lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props): ReactElement {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center rounded-lg p-[3px] group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-horizontal/tabs:data-[size=md]:h-10 group-data-horizontal/tabs:data-[size=sm]:h-8 data-[variant=line]:rounded-none data-[variant=line]:p-0 data-[variant=pill]:rounded-none data-[variant=pill]:p-0",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-4 bg-transparent",
        pill: "gap-2 bg-transparent",
      },
      // Height is driven by the data-[size=…] selectors in the base string
      // above (so it can compose with variant/orientation); these slots exist
      // only to type the prop, set the default, and emit the data-size attr.
      size: {
        sm: "",
        md: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  size = "sm",
  ...props
}: TabsPrimitive.List.Props &
  VariantProps<typeof tabsListVariants>): ReactElement {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={size}
      className={cn(tabsListVariants({ variant, size }), className)}
      {...props}
    />
  );
}

// `hover:` and `data-active:` both paint the trigger text with
// `tabs-foreground-selected`: hover and selected resolve to the same tone
// (foreground-emphasis), so they intentionally share one token rather than
// minting a duplicate-valued `tabs-foreground-hover`. The line indicator does
// split the two (primary-500 hover / primary-600 selected).
function TabsTrigger({
  className,
  ...props
}: TabsPrimitive.Tab.Props): ReactElement {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "text-tabs-foreground-rest hover:text-tabs-foreground-selected data-active:text-tabs-foreground-selected focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[variant=default]/tabs-list:data-active:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-active:bg-background",
        "group-data-[variant=line]/tabs-list:h-auto group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:border-0 group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:px-0 group-data-[variant=line]/tabs-list:text-base group-data-[variant=line]/tabs-list:group-data-[size=md]/tabs-list:py-2 group-data-[variant=line]/tabs-list:group-data-[size=sm]/tabs-list:py-1 group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=pill]/tabs-list:hover:bg-tabs-pill-fill-hover group-data-[variant=pill]/tabs-list:data-active:bg-tabs-pill-fill-selected group-data-[variant=pill]/tabs-list:px-3 group-data-[variant=pill]/tabs-list:py-2",
        "group-data-[variant=line]/tabs-list:hover:after:bg-tabs-indicator-fill-hover group-data-[variant=line]/tabs-list:data-active:after:bg-tabs-indicator-fill-selected after:absolute after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:hover:after:opacity-100 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: TabsPrimitive.Panel.Props): ReactElement {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
