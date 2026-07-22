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
import { ArrowLeft, Maximize, Minimize, X } from "lucide-react";
import { type JSX } from "react";

import { useSidepane } from "../../../../hooks/use-sidepane";

// Manage-apps panel header: a back button to the device view + the "Devices"
// label on the left; the maximize/restore + close controls on the right, wired
// straight to useSidepane() (same contract as SidepaneHeader — this drill-in
// sub-view needs the back affordance the shared header has no slot for, so it
// mirrors the header's acrylic framing and right-side controls locally).
export function ManageAppsHeader({
  onBack,
}: {
  onBack: () => void;
}): JSX.Element {
  const { maximized, close, toggleMaximize } = useSidepane();
  const MaximizeGlyph = maximized ? Minimize : Maximize;
  const maximizeLabel = maximized ? "Restore" : "Maximize";

  return (
    <div className="bg-surface-acrylic-board sticky top-0 z-10 flex items-center justify-between gap-2 px-4 pt-4 pb-2 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="subtle"
          size="icon-xs"
          aria-label="Back to device"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <span className="text-foreground-primary text-sm font-medium">
          Devices
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="subtle"
          size="icon-xs"
          aria-label={maximizeLabel}
          onClick={toggleMaximize}
        >
          <MaximizeGlyph />
        </Button>
        <div
          className="border-divider h-3 w-px shrink-0 border-l"
          aria-hidden
        />
        <Button
          type="button"
          variant="subtle"
          size="icon-xs"
          aria-label="Close"
          onClick={close}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}
