import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { type ReactElement } from "react";

type InactiveToggleProps = {
  showInactive: boolean;
  // True while the filter switch is in flight (the new page is loading in a
  // transition). Disables the button so a double-click can't queue a second
  // switch, and swaps the chevron for a spinner as a loading affordance.
  isPending?: boolean;
  onToggle: () => void;
};

// Trailing icon: a spinner while the filter switch is loading, otherwise the
// chevron pointing in the direction the click will move (up = collapse,
// down = expand). A plain helper (not a component) so the button JSX stays flat
// without tripping `react/no-multi-comp`.
function toggleIcon(showInactive: boolean, isPending: boolean): ReactElement {
  if (isPending) {
    return <Loader2 aria-hidden="true" className="size-4 animate-spin" />;
  }
  return showInactive ? (
    <ChevronUp aria-hidden="true" className="size-4" />
  ) : (
    <ChevronDown aria-hidden="true" className="size-4" />
  );
}

/**
 * Reveal/hide control for inactive DWs. Rendered as the grid's fixed footer
 * (below the scroll region) so it stays put while cards scroll. Plain text
 * link (PR346 styling). No count — the hidden inactive workers aren't fetched
 * (server-side filter), so their number is unknown.
 */
export function InactiveToggle({
  showInactive,
  isPending = false,
  onToggle,
}: InactiveToggleProps): ReactElement {
  return (
    <div className="flex shrink-0 justify-center py-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={isPending}
        aria-busy={isPending}
        className="text-foreground-tertiary hover:text-foreground-primary flex shrink-0 items-center gap-0.5 rounded-sm text-sm disabled:opacity-60"
      >
        {showInactive
          ? "Hide inactive digital workers"
          : "Show inactive digital workers"}
        {toggleIcon(showInactive, isPending)}
      </button>
    </div>
  );
}
