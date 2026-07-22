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
import { type JSX } from "react";

import { RailNavRow } from "./rail-nav-row";
import { type NavItemData } from "../types";

// Same `NavItemData` shape as `<NavItem>` plus the resolved `active` state —
// rail rows render `icon` centered with no label text (it's the aria-label).
// See nav-item.tsx for why `to` is a loose string (single chrome for sico
// routes + downstream extras).
type RailNavItemProps = NavItemData & {
  readonly active: boolean;
};

// Route specialisation of `RailNavRow`: the outer element is a router `<Link>`,
// with `label` becoming its `aria-label` (rail rows show no text).
export function RailNavItem({
  to,
  label,
  icon,
  active,
}: RailNavItemProps): JSX.Element {
  return (
    <RailNavRow
      icon={icon}
      active={active}
      render={<Link to={to} aria-label={label} />}
    />
  );
}
