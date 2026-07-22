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
