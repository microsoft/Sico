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

import { cn } from "@sico/ui/lib/utils.ts";
import { cloneElement, type JSX, type ReactNode } from "react";

import { type NavRowRenderElement } from "./nav-row";

// Collapsed-rail counterpart of `NavRow`: icon-only, centered, no label text
// (the label becomes the outer element's `aria-label`, supplied by the caller
// on `render`).
type RailNavRowProps = {
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly render: NavRowRenderElement;
};

const RAIL_NAV_ROW_CLASS =
  "text-foreground-secondary hover:bg-surface-muted data-[active]:bg-surface-muted flex size-9 items-center justify-center rounded-lg";

export function RailNavRow({
  icon,
  active,
  render,
}: RailNavRowProps): JSX.Element {
  return cloneElement(render, {
    className: cn(RAIL_NAV_ROW_CLASS, render.props.className),
    "data-active": active ? true : undefined,
    children: icon,
  });
}
