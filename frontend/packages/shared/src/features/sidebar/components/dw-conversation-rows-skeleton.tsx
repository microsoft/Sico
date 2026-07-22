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
import { type JSX } from "react";

import { DW_PREVIEW } from "../constants";

// The conversation-row placeholders — `count` skeleton bars, each matching a
// real row (h-8, `px-2`, `flex-1` bar mirroring the truncated title). Shared by
// the first-load skeleton (`DwConversationNavSkeleton`) AND the load-more
// indicator in `dw-conversation-nav`, so the two can't drift. Defaults to
// `DW_PREVIEW`.
export function DwConversationRowsSkeleton({
  count = DW_PREVIEW,
}: {
  readonly count?: number;
}): JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key -- static placeholder count
          key={index}
          data-testid="conversation-skeleton-row"
          className="flex h-8 items-center px-2"
        >
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </>
  );
}
