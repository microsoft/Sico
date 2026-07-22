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

import type { ComponentProps, ReactElement } from "react";

import { cn } from "../../lib/utils";

/**
 * Bare native textarea — shadcn base-nova restyle (no upstream drift).
 *
 * Leaf primitive. Compose with `<InputGroup>` (via `<InputGroup.Textarea>`)
 * for borders + focus ring + addon slots, or with `<Field>` for label and
 * error wiring.
 *
 * `field-sizing-content` lets the textarea auto-grow with its value — no
 * JS measurement required. Falls back to `min-h-16` on browsers that
 * don't support it (Safari < 17.4 / Firefox < 124).
 *
 * Deletions from upstream:
 *   - `dark:` variants (SICO has no dark theme yet).
 *   - `md:text-sm` responsive override (SICO uses 14px everywhere).
 */
function Textarea({
  className,
  ...props
}: ComponentProps<"textarea">): ReactElement {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input-stroke-rest flex field-sizing-content min-h-16 w-full rounded-lg border bg-transparent px-3 py-2 text-sm transition-colors outline-none",
        "placeholder:text-foreground-faint",
        "hover:border-input-stroke-hover",
        "focus-visible:border-input-stroke-pressed focus-visible:shadow-s",
        "disabled:bg-surface-canvas disabled:text-foreground-faint disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent",
        "aria-invalid:bg-input-fill-error aria-invalid:border-input-stroke-error",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
