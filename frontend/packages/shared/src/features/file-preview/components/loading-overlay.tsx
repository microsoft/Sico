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
