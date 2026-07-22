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

import { NavRow } from "./nav-row";
import { type NavItemData } from "../types";

// Props are a `NavItemData` (the data shape — `to`/`label`/`icon`) plus the
// resolved `active` state. `to` is a loose string so this one component serves
// both sico's own routes AND downstream extras (whose routes sico can't name
// at the type level — see types.ts). The cost: built-in call sites lose
// literal-route checking (a typo in `to="/digital-worker"` no longer errors at
// compile time). Accepted deliberately to keep a single chrome.
type NavItemProps = NavItemData & {
  readonly active?: boolean;
};

// Route specialisation of `NavRow`: the outer element is a router `<Link>`.
// Interactive (non-route) rows — e.g. dwp's Notification trigger — compose
// `NavRow` directly with their own `<button>`/popover-trigger element.
export function NavItem({
  to,
  icon,
  label,
  active,
}: NavItemProps): JSX.Element {
  return (
    <NavRow
      icon={icon}
      label={label}
      active={active}
      render={<Link to={to} aria-current={active ? "page" : undefined} />}
    />
  );
}
