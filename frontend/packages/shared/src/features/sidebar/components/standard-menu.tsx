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

import { Box } from "lucide-react";
import { type JSX, type ReactNode } from "react";

import { DwSection } from "./dw-section";
import { NavItem } from "./nav-item";
import { type ActiveNavState } from "../hooks/use-active-nav";
import { type NavItemData } from "../types";

type Props = {
  readonly active: ActiveNavState;
  readonly extraNavItems?: readonly NavItemData[];
  readonly menuTopExtras?: ReactNode;
};

// The standard expanded-sidebar menu: Digital Workers group (list preview),
// Projects, and downstream extra nav rows. Shown when NOT inside a specific
// Digital Worker (where the sidebar switches to conversation mode instead).
export function StandardMenu({
  active,
  extraNavItems,
  menuTopExtras,
}: Props): JSX.Element {
  const { nav } = active;
  return (
    <>
      {menuTopExtras}
      <NavItem
        to="/project"
        icon={<Box aria-hidden="true" className="size-5" />}
        label="Projects"
        active={nav === "project"}
      />
      {extraNavItems?.map((item) => (
        <NavItem
          key={item.to}
          to={item.to}
          icon={item.icon}
          label={item.label}
          active={active.isActive(item.to)}
        />
      ))}
      {/* Extra top gap sets the Digital Workers group apart from the nav rows
          above so its list preview doesn't read as another row. */}
      <div className="mt-2">
        <DwSection />
      </div>
    </>
  );
}
