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

import type { ReactNode } from "react";

type CardGridProps = {
  children: ReactNode;
  // Forwarded to the outer container — use for `role`/`aria-label` on the
  // grid (e.g. skeleton's `role="status"`). Defaults to none.
  readonly "aria-label"?: string;
  readonly role?: string;
};

/**
 * Responsive card grid used by list pages (Digital Workers, Projects).
 *
 * Container-query driven (`@container`), so columns respond to the grid's
 * own width — not the viewport — which keeps it correct inside the
 * local-scroll layout and the sidebar-narrowed content area. Uses Tailwind's
 * built-in container breakpoints rather than arbitrary pixel values:
 * `@xl` (576px) → 2 cols, `@4xl` (896px) → 3 cols, `@7xl` (1280px) → fill as
 * many ≥340px columns as fit. Card height is owned by the card itself.
 */
export function CardGrid({
  children,
  "aria-label": ariaLabel,
  role,
}: CardGridProps): React.JSX.Element {
  return (
    <div className="@container">
      <div
        role={role}
        aria-label={ariaLabel}
        className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"
      >
        {children}
      </div>
    </div>
  );
}
