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
import { PanelLeftOpen } from "lucide-react";
import { type JSX, type ReactNode } from "react";

import { type NavItemData } from "../types";
import { RailBody } from "./rail-body";
import sicoLogo from "../../../assets/sico-logo.svg";
import { type ActiveNavState } from "../hooks/use-active-nav";

export function CollapsedRail({
  active,
  onExpand,
  extraNavItems,
  headerExtras,
  menuTopExtras,
}: {
  readonly active: ActiveNavState;
  readonly onExpand: () => void;
  // Data-driven rail entries appended after the built-in items. Default
  // `undefined` — sico shows none; dwp injects e.g. a My Team rail item.
  readonly extraNavItems?: readonly NavItemData[];
  // Header-area slot rendered near the top of the rail (dwp: notification bell).
  readonly headerExtras?: ReactNode;
  // Free-form slot rendered at the top of the rail's icon column, above the
  // built-in items — the collapsed counterpart of the expanded menu top slot.
  // dwp injects the Notification rail row here (compose from `RailNavRow`).
  readonly menuTopExtras?: ReactNode;
}): JSX.Element {
  return (
    <div
      data-testid="sidebar-rail"
      className="flex flex-1 flex-col items-start gap-1 px-1 py-1.5"
    >
      <div className="group relative flex size-9 items-center justify-center">
        {/* Reuse the expanded logo asset and clip to just the figure-8
            mark (left 20px of the 60×20 viewBox). Sharing one src with
            the expanded sidebar means the image is already cached when
            toggling, so the mark never flashes blank on collapse. On hover
            the mark swaps to the expand button. */}
        <span className="size-5 overflow-hidden group-focus-within:opacity-0 group-hover:opacity-0">
          <img src={sicoLogo} alt="SICO" className="h-5 w-auto max-w-none" />
        </span>
        <Button
          variant="subtle"
          size="icon-lg"
          aria-label="Expand sidebar"
          onClick={onExpand}
          className="absolute opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <PanelLeftOpen aria-hidden="true" />
        </Button>
      </div>

      {headerExtras}

      <RailBody
        active={active}
        menuTopExtras={menuTopExtras}
        extraNavItems={extraNavItems}
      />
    </div>
  );
}
