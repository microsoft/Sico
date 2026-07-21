import { Spinner } from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type { JSX } from "react";

export type LoadingOverlayProps = {
  /**
   * Paint the opaque `bg-surface-basic` behind the spinner (default) so a
   * half-painted body is hidden. Pass `false` for viewers that overlay a spinner
   * on a stage that should stay visible (e.g. the GLB canvas).
   */
  surface?: boolean;
};

/**
 * Absolutely-positioned, centered loading spinner that fills its
 * `relative`-positioned parent — the shared "still loading" overlay for the
 * file-preview viewers (text / markdown / pdf / office / video / glb).
 */
export function LoadingOverlay({
  surface = true,
}: LoadingOverlayProps): JSX.Element {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center",
        surface && "bg-surface-basic",
      )}
    >
      <Spinner size="lg" />
    </div>
  );
}
