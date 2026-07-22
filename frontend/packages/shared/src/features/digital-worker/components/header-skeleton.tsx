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

import { Skeleton } from "@sico/ui";
import type { JSX } from "react";

/**
 * Placeholder for `<Header>` while its agent-detail query is in flight. Mirrors
 * the header's layout (h-12, the avatar + name/role button on the left, the
 * right-aligned actions slot) so the swap doesn't shift the row. The avatar
 * placeholder tracks `DwAvatar size="xs"` (size-5); only the avatar + name text
 * are skeletons.
 */
export function HeaderSkeleton(): JSX.Element {
  return (
    <header
      aria-hidden="true"
      data-testid="header-skeleton"
      className="flex h-12 items-center justify-between gap-0.5 px-5"
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <div className="flex items-center gap-2 px-1 py-0.5">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="size-7 shrink-0 rounded-md" />
    </header>
  );
}
