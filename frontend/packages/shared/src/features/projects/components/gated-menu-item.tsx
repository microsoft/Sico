import {
  DropdownMenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type * as React from "react";

// The single reason shown when a row action is gated by permission. Every
// gated menu item / button across the members + asset tables reuses it so the
// copy stays consistent.
export const PERMISSION_DENIED_TOOLTIP = "Available to Owners and Admins only.";

// `.own` actions can also be performed by the item's owner, so their denial
// reason names the ownership rule rather than the pure-admin one.
export const DISMISS_DENIED_TOOLTIP =
  "You can only dismiss workers you invited.";
export const DELETE_DENIED_TOOLTIP = "You can only delete items you created.";

export type GatedMenuItemProps = {
  /** Whether the viewer may perform this action. */
  allowed: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  /** `destructive` tints the item (delete/remove/dismiss). */
  variant?: "default" | "destructive";
  /** Reason shown on the disabled item. Defaults to the pure-admin copy; pass a
   * specific reason for `.own` actions (e.g. "You can only delete items you
   * created."). */
  deniedTooltip?: string;
};

/**
 * A dropdown menu item that stays VISIBLE regardless of permission: allowed →
 * a normal actionable item; not allowed → greyed, non-interactive, and wrapped
 * in a Tooltip explaining why.
 *
 * The disabled item deliberately does NOT use the native `disabled` prop —
 * Base UI adds `data-disabled:pointer-events-none`, which would suppress the
 * hover the Tooltip needs. Instead it greys the item, keeps the menu open
 * (`closeOnClick={false}`), and no-ops the click, so hover still fires the
 * tooltip while the action can't be triggered.
 */
export function GatedMenuItem({
  allowed,
  onSelect,
  children,
  variant = "default",
  deniedTooltip = PERMISSION_DENIED_TOOLTIP,
}: GatedMenuItemProps): React.JSX.Element {
  if (allowed) {
    return (
      <DropdownMenuItem variant={variant} onClick={onSelect}>
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <DropdownMenuItem
            // Force the neutral variant when disabled: a greyed item reads as
            // "unavailable", so keeping the destructive red (faded) would be a
            // confusing half-signal. The default item text greys via opacity.
            variant="default"
            aria-disabled
            closeOnClick={false}
            className={cn("cursor-not-allowed opacity-50")}
            onClick={(event) => event.preventDefault()}
          />
        }
      >
        {children}
      </TooltipTrigger>
      {/* Override the shared tooltip's `text-balance`: for these short reason
          strings, balancing splits them at an awkward point (e.g. "Owners /
          and Admins"). Normal wrapping fills a line first, and `max-w-64` keeps
          the longer `.own` reasons from overflowing the viewport. */}
      <TooltipContent className="text-wrap">{deniedTooltip}</TooltipContent>
    </Tooltip>
  );
}
