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

import { type JSX, type ReactNode } from "react";

// Small count pill for a nav row's `trailing` slot (e.g. Notification's unread
// count). Distinct from `@sico/ui`'s status `Badge` (h-5/h-6 status labels):
// a danger pill that stays circular for a single digit and grows horizontally
// into a pill for multi-digit counts — no border.
export function NavBadge({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      // eslint-disable-next-line tailwindcss/no-custom-classname -- `bg-danger-500` (brand) and `text-foreground-on-inverted` (semantic) are valid Tailwind v4 @theme vars, unresolvable here because @sico/shared has no globals.css on the plugin's cssFiles path.
      // `h-4 min-w-4` (min-width == height) keeps a 1-digit badge circular
      // and lets multi-digit counts grow horizontally into a pill without
      // vertical distortion. `px-1` supplies horizontal breathing room when
      // the digit(s) exceed min-width.
      className="bg-danger-500 text-2xs text-foreground-on-inverted inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 leading-none font-medium tracking-wide"
    >
      {children}
    </span>
  );
}
