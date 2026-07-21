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
        <p className="text-foreground-primary leading-body text-lg font-medium">
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
