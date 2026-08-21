import { Button } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { PanelRight } from "lucide-react";
import type * as React from "react";

export type CollapsiblePanelShellProps = {
  /** Accessible name for the panel region — not shown visibly (both consumers
   * hide the title text; the header shows only the collapse button + actions).
   * Drives the section's `aria-label` so AT can tell the panels apart. */
  label: string;
  /** Collapse the panel — the page owns the state + renders a restore button. */
  onCollapse: () => void;
  /** Header actions left of the collapse button (e.g. knowledge's `…` menu). */
  actions?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Shared chrome for a collapsible right-side panel — a static `w-80` column with
 * an `h-12` header (collapse button + optional actions) over a scrolling body.
 * Used by both the asset-detail "Detail" panel and the project-overview drawer;
 * both render it the same way, so the layout is fixed (no title text, no left
 * border) rather than parameterised. Presentational: it owns no collapse STATE
 * (the page does) — it only raises `onCollapse`; the page renders the restore
 * button in its `ProjectPageHeader` `rightSlot` when collapsed.
 */
export function CollapsiblePanelShell({
  label,
  onCollapse,
  actions,
  children,
}: CollapsiblePanelShellProps): React.JSX.Element {
  return (
    <section aria-label={label} className="flex h-full w-80 shrink-0 flex-col">
      <header
        className={cn(
          "flex h-12 items-center pr-5",
          // A lone collapse button pins left; with actions, collapse sits left
          // and the actions cluster right.
          actions ? "justify-between" : "justify-start",
        )}
      >
        <Button
          variant="subtle"
          size="icon-sm"
          aria-label="Collapse panel"
          onClick={onCollapse}
        >
          <PanelRight />
        </Button>
        {actions ? (
          <div className="flex items-center gap-1">{actions}</div>
        ) : null}
      </header>
      <div className="scrollbar flex flex-1 flex-col gap-8 overflow-y-auto pt-8 pr-5 pb-5">
        {children}
      </div>
    </section>
  );
}
