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

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@sico/ui";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { type JSX } from "react";

import { type Sandbox } from "../schemas/sandbox";

export type SandboxDropdownProps = {
  sandboxes: Sandbox[];
  current: Sandbox;
  onSelect: (sandbox: Sandbox) => void;
  onViewAll: () => void;
};

const COPY = {
  viewAll: "View all",
} as const;

/**
 * Device switcher in the instance header (mounted in SidepaneHeader's
 * `titleSlot`): the current device name as a trigger, a checkmarked list of the
 * others, and a "View all" footer that returns to the grid. Only lists the
 * switch options when there is more than one device.
 */
export function SandboxDropdown({
  sandboxes,
  current,
  onSelect,
  onViewAll,
}: SandboxDropdownProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="border-stroke-subtle-card-rest text-foreground-secondary hover:bg-button-subtle-fill-hover flex max-w-40 items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
        <span className="truncate">{current.displayName}</span>
        <ChevronDown className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {sandboxes.length > 1
          ? sandboxes.map((sandbox) => (
              <DropdownMenuItem
                key={sandbox.sandboxId}
                onClick={() => onSelect(sandbox)}
                className="justify-between"
              >
                <span className="truncate">{sandbox.displayName}</span>
                {sandbox.sandboxId === current.sandboxId ? <Check /> : null}
              </DropdownMenuItem>
            ))
          : null}
        {sandboxes.length > 1 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onClick={onViewAll} className="justify-between">
          {COPY.viewAll}
          <ArrowRight />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
