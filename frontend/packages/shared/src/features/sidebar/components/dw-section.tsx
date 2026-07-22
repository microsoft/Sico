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

import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type JSX } from "react";

import { DwList } from "./dw-list";

// Standard-menu "Digital Workers" group: a static caplabel (all-caps section
// header — labels only, no navigation) with an "all" link on the right that
// jumps to the full list, above the preview rows. Splitting the two affordances
// keeps the header from overloading one row (see the former NavItem).
export function DwSection(): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-9 items-center justify-between gap-2 pr-1 pl-2">
        <span className="text-foreground-tertiary truncate text-xs font-medium tracking-wider uppercase">
          Digital workers
        </span>
        <Link
          to="/digital-worker"
          aria-label="View all digital workers"
          className="text-foreground-tertiary hover:text-foreground-primary flex shrink-0 items-center gap-0.5 rounded-sm text-sm font-medium"
        >
          View all
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <DwList />
    </div>
  );
}
