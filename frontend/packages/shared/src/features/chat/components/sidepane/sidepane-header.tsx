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

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@sico/ui";
import { Maximize, Minimize, X } from "lucide-react";
import type { JSX, ReactNode } from "react";

import { type FileTypeIcon } from "../../../../utils/file-icon";
import { useSidepane } from "../../hooks/use-sidepane";

export type SidepaneHeaderProps = {
  // File-type / preview glyph shown in the left tile. `FileTypeIcon` is the
  // lucide ∩ tabler common shape (renders with a `className`), so callers can
  // pass either a lucide glyph or the extension-derived `iconForFilename` icon.
  icon: FileTypeIcon;
  // Optional: the instance view names the device through its `titleSlot`
  // dropdown instead, so it omits the word (legacy SandboxInstance has no
  // title). Every other previewer passes one.
  title?: string;
  // Inline after the title (D2 drops a device dropdown here).
  titleSlot?: ReactNode;
  // Extra actions before the fixed maximize/close (markdown Download lands here).
  actionsSlot?: ReactNode;
  // Right side, before maximize (D2 drops a status badge here).
  statusSlot?: ReactNode;
};

/**
 * The single configurable header every previewer mounts at its top — icon +
 * title (+ slots) on the left, caller actions then the fixed maximize/restore
 * and close controls on the right. Legacy copy-pasted this markup five times;
 * the slots let D2/D3 add their dropdown/status without editing this file.
 *
 * Maximize/restore and close are wired straight to `useSidepane()`; the
 * `aria-label`s give the icon buttons accessible names (resolves axe
 * `button-name` for every previewer in one place). Figma 17810:83389.
 */
export function SidepaneHeader({
  icon: Glyph,
  title,
  titleSlot,
  actionsSlot,
  statusSlot,
}: SidepaneHeaderProps): JSX.Element {
  const { maximized, close, toggleMaximize } = useSidepane();
  const MaximizeGlyph = maximized ? Minimize : Maximize;
  const maximizeLabel = maximized ? "Restore" : "Maximize";

  return (
    <div className="bg-surface-acrylic-board sticky top-0 z-10 flex items-center justify-between gap-2 px-4 pt-4 pb-2 backdrop-blur-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          data-testid="sidepane-header-icon"
          className="bg-surface-icon-tile flex size-7 shrink-0 items-center justify-center rounded-md"
        >
          <Glyph className="text-icon-secondary size-4" />
        </div>
        <div className="flex min-w-0 items-center gap-0.5">
          {title ? (
            <p className="text-foreground-primary truncate text-lg leading-tight">
              {title}
            </p>
          ) : null}
          {titleSlot}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {statusSlot}
        {actionsSlot}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="subtle"
                size="icon-xs"
                aria-label={maximizeLabel}
                onClick={toggleMaximize}
              >
                <MaximizeGlyph className="size-4" />
              </Button>
            }
          />
          <TooltipContent>{maximizeLabel}</TooltipContent>
        </Tooltip>
        <div
          className="border-divider h-3 w-px shrink-0 border-l"
          aria-hidden
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="subtle"
                size="icon-xs"
                aria-label="Close"
                onClick={close}
              >
                <X className="size-4" />
              </Button>
            }
          />
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
