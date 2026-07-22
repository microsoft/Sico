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
