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

import { Input } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type {
  ChangeEventHandler,
  FocusEventHandler,
  ReactElement,
  Ref,
} from "react";

type CharCountInputProps = {
  // Hard character cap — enforced via native maxLength and shown as `n/max`.
  max: number;
  value: string;
  id?: string;
  name?: string;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  ariaInvalid?: boolean;
  ref?: Ref<HTMLInputElement>;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
};

/**
 * Single-line input with an `n/max` counter pinned inside its right edge
 * (per design). A character cap (not word count) so the limit is meaningful
 * for CJK text. Wraps the shared `<Input>`; the wrapper is `relative` and the
 * input gets right padding so typed text never slides under the counter.
 * Props are wired explicitly (no spreading) per lint rules.
 */
export function CharCountInput({
  max,
  value,
  id,
  name,
  placeholder,
  autoComplete,
  className,
  ariaInvalid,
  ref,
  onChange,
  onBlur,
}: CharCountInputProps): ReactElement {
  const length = value.length;
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={max}
        aria-invalid={ariaInvalid ? true : undefined}
        value={value}
        ref={ref}
        onChange={onChange}
        onBlur={onBlur}
        className={cn("pr-14", className)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums",
          length >= max
            ? "text-foreground-secondary font-medium"
            : "text-foreground-faint",
        )}
      >
        {length}/{max}
      </span>
    </div>
  );
}
