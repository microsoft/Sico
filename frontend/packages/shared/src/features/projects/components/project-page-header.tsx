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

import { Button } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { ArrowLeft } from "lucide-react";
import type * as React from "react";

export type ProjectPageHeaderProps = {
  /** First breadcrumb segment (e.g. "Project") — clickable, routes via `onBack`. */
  label: string;
  /** Back-arrow click AND the `label` segment click both navigate up one level. */
  onBack: () => void;
  /**
   * Current breadcrumb leaf (the open asset's name). When set, the bar renders
   * `label / current` — `label` muted+clickable, `current` primary+truncated.
   * Omitted on list/tag pages, which show `label` alone.
   */
  current?: string;
  /** Right-side slot — e.g. overview's collapsed-drawer restore button. */
  rightSlot?: React.ReactNode;
  /** Page gutter so the back button aligns with the title below (px-16 / px-20). */
  className?: string;
};

/**
 * Shared top bar for every per-project page. Lives INSIDE the left content
 * column (never the right rail) so the drawer / detail panel stays full-height.
 * Presentational — each page wires its own `onBack`. Arrow: Figma 19456-11537.
 *
 * Breadcrumb (Figma 19230-55661): the `label` segment is always clickable (up
 * one level); passing `current` appends the open asset as a muted-then-primary
 * `label / current` trail, with the leaf truncating on overflow.
 */
export function ProjectPageHeader({
  label,
  onBack,
  current,
  rightSlot,
  className,
}: ProjectPageHeaderProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center justify-between gap-4 px-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="subtle"
          size="icon-xs"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <nav className="flex min-w-0 items-center gap-1 text-base">
          <button
            type="button"
            onClick={onBack}
            className="leading-body-2 text-foreground-tertiary hover:text-foreground-emphasis shrink-0 cursor-pointer"
          >
            {label}
          </button>
          {current === undefined ? null : (
            <>
              <span
                aria-hidden
                className="leading-body-2 text-foreground-tertiary shrink-0"
              >
                /
              </span>
              <span className="leading-body-2 text-foreground-emphasis truncate">
                {current}
              </span>
            </>
          )}
        </nav>
      </div>
      {rightSlot}
    </div>
  );
}
