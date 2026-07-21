import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactElement } from "react";

type InactiveToggleProps = {
  count: number;
  showInactive: boolean;
  onToggle: () => void;
};

/**
 * Reveal/hide control for inactive DWs. Rendered as the grid's fixed footer
 * (below the scroll region) so it stays put while cards scroll. Plain text
 * link (PR346 styling).
 */
export function InactiveToggle({
  count,
  showInactive,
  onToggle,
}: InactiveToggleProps): ReactElement {
  return (
    <div className="flex shrink-0 justify-center py-3">
      <button
        type="button"
        onClick={onToggle}
        className="text-foreground-tertiary hover:text-foreground-primary flex shrink-0 items-center gap-0.5 rounded-sm text-sm"
      >
        {showInactive
          ? `Hide ${String(count)} inactive digital workers`
          : `Show ${String(count)} inactive digital workers`}
        {showInactive ? (
          <ChevronUp aria-hidden="true" className="size-4" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
}
