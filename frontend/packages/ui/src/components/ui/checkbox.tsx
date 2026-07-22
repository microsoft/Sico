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

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "../../lib/utils";

/**
 * Bare checkbox — shadcn base-nova restyle (no upstream drift).
 *
 * Deletions from upstream:
 *   - `dark:` variants (SICO has no dark theme yet).
 *
 * Token swaps (shadcn theme-bridge alias → SICO semantic token). The rest and
 * invalid borders mirror the sibling form controls in `input.tsx` /
 * `textarea.tsx`; the focus / invalid rings are the base-nova ring model kept
 * verbatim. All pairs are runtime-identical through the bridge in `globals.css`
 * except the invalid border, which deepens danger-500 → danger-700 to match the
 * input/textarea error stroke:
 *   - `rounded-[4px]`            → `rounded-sm` (4px; SICO forbids arbitrary values)
 *   - `border-input`             → `border-input-stroke-rest`
 *   - `border-ring` / `ring-ring`→ `border-focus-rest` / `ring-focus-rest`
 *   - `border-destructive`       → `border-input-stroke-error` (danger-500 → danger-700, sibling-consistent)
 *   - `ring-destructive`         → `ring-focus-error`
 *   - `bg-primary`/`border-primary` → `bg-button-primary-fill-rest`/`border-button-primary-fill-rest`
 *   - `text-primary-foreground`  → `text-foreground-on-inverted`
 */
function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props): ReactElement {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input-stroke-rest focus-visible:border-focus-rest focus-visible:ring-focus-rest/50 aria-invalid:border-input-stroke-error aria-invalid:ring-focus-error/20 aria-invalid:aria-checked:border-button-primary-fill-rest data-checked:border-button-primary-fill-rest data-checked:bg-button-primary-fill-rest data-checked:text-foreground-on-inverted relative flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
