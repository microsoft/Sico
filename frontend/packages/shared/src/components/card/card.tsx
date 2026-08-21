import { Slot } from "@radix-ui/react-slot";
import { cn } from "@sico/ui/lib/utils.ts";
import { type ReactElement, type ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  className?: string;
  // Merge the surface onto the single child (a `<Link>`/`<button>`) instead
  // of a wrapping `<div>`, so the card itself is the interactive element.
  asChild?: boolean;
};

/**
 * Shared card surface for list pages (Digital Workers, Projects) — background,
 * border with hover/active/focus states, radius, padding, column flex. Each
 * card adds its own height/gaps/alignment via `className`.
 */
export function Card({
  children,
  className,
  asChild = false,
}: CardProps): ReactElement {
  const surface =
    "bg-surface-basic border-stroke-subtle-card-rest hover:border-stroke-subtle-card-hover hover:shadow-m active:border-stroke-subtle-card-pressed focus-visible:outline-focus-rest flex w-full flex-col rounded-xl border p-5 no-underline focus-visible:outline-2 focus-visible:outline-offset-2";
  const Comp = asChild ? Slot : "div";
  return <Comp className={cn(surface, className)}>{children}</Comp>;
}
