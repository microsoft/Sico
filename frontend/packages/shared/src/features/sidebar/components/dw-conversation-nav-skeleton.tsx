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
import { ChevronLeft } from "lucide-react";
import { type JSX } from "react";

import { DwConversationRowsSkeleton } from "./dw-conversation-rows-skeleton";

// Loading placeholder for the sidebar's conversation mode (DwConversationNav):
// mirrors the real block's three-row shape — "Session" back-header, "New
// session" row, then a few conversation rows — so the swap-in doesn't jump.
export function DwConversationNavSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversations"
      className="flex min-h-0 flex-1 flex-col gap-1"
    >
      {/* Back header — chevron + a short label bar, matching the real
          `px-1` inset and h-9 height. */}
      <div className="flex h-9 items-center gap-1 px-1">
        <ChevronLeft
          aria-hidden="true"
          className="text-foreground-tertiary size-4 shrink-0"
        />
        <Skeleton className="h-3 w-16" />
      </div>
      {/* New session — mirrors the real secondary Button: a `p-2` wrapper
          around an h-9 (size-lg) button-shaped bar, so the swap-in keeps the
          same 52px block height and doesn't shift the rows below. */}
      <div className="p-2">
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <DwConversationRowsSkeleton />
    </div>
  );
}
