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
import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX } from "react";

// Distinct widths double as React keys — no array-index key needed.
const ASSISTANT_LINE_WIDTHS = ["w-full", "w-11/12", "w-2/3"];

// Stand-in for the message list while history loads — a few alternating
// user/assistant placeholders sized to the conversation column (max-w-190,
// matches message-list.tsx). The animate-pulse hint comes from <Skeleton>;
// nothing else needs motion. Replaces the centered <Spinner> fallback so the
// loading screen previews the upcoming layout instead of an unrelated dot
// animation.
export function MessageHistorySkeleton(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Loading messages"
      data-testid="message-history-skeleton"
      className="mx-auto flex w-full max-w-190 flex-col gap-4 p-4"
    >
      {/* Assistant turn: a stack of text lines. */}
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        {ASSISTANT_LINE_WIDTHS.map((width) => (
          <Skeleton key={width} className={cn("h-4", width)} />
        ))}
      </div>
      {/* User turn: a single rounded bubble (mirrors UserCard: rounded-xl + py-3 around text-base, ~h-12). */}
      <div aria-hidden="true" className="flex justify-end">
        <Skeleton className="h-12 w-72 rounded-xl" />
      </div>
    </div>
  );
}
