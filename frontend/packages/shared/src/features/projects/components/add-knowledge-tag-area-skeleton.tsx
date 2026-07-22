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
import type * as React from "react";

/**
 * Loading surface for the Add Knowledge tag area — a label + "Add tag"-sized
 * pill, so the dialog doesn't reflow when `useKnowledgeTagsQuery` resolves.
 */
export function AddKnowledgeTagAreaSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading knowledge tags"
      className="flex flex-col gap-3"
    >
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    </div>
  );
}
