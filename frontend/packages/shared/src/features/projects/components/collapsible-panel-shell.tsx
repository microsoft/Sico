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
import { PanelRight } from "lucide-react";
import type * as React from "react";

export type CollapsiblePanelShellProps = {
  /** Header title — e.g. "Detail" (asset detail) or "Project details" (drawer). */
  title: string;
  /** Collapse the panel — the page owns the state + renders a restore button. */
  onCollapse: () => void;
  /** Header actions left of the collapse button (e.g. knowledge's `…` menu). */
  actions?: React.ReactNode;
  /** Body section gap. Drawer packs more sections (`gap-6`); detail uses `gap-8`. */
  bodyGap?: "gap-6" | "gap-8";
  children: React.ReactNode;
};

/**
 * Shared chrome for a collapsible right-side panel — a static `w-90` column with
 * an `h-12` header (title + optional actions + collapse button) over a scrolling
 * body. Used by both the asset-detail "Detail" panel and the project-overview
 * drawer. Presentational: it owns no collapse STATE (the page does) — it only
 * raises `onCollapse`; the page renders the restore button in its
 * `ProjectPageHeader` `rightSlot` when collapsed.
 */
export function CollapsiblePanelShell({
  title,
  onCollapse,
  actions,
  bodyGap = "gap-8",
  children,
}: CollapsiblePanelShellProps): React.JSX.Element {
  return (
    <section
      aria-label={title}
      className="border-divider flex h-full w-90 shrink-0 flex-col border-l"
    >
      <header className="flex h-12 items-center justify-between px-5">
        <p className="leading-body text-foreground-primary text-lg font-medium">
          {title}
        </p>
        <div className="flex items-center gap-1">
          {actions}
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Collapse panel"
            onClick={onCollapse}
          >
            <PanelRight />
          </Button>
        </div>
      </header>
      <div
        className={cn(
          "scrollbar flex flex-1 flex-col overflow-y-auto p-6",
          bodyGap,
        )}
      >
        {children}
      </div>
    </section>
  );
}
