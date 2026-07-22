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

import { type ReactNode } from "react";

// Data shape for a sidebar nav row. sico's own `NavItem`/`RailNavItem`
// hard-code `to` to the routes sico/app registers; a downstream app (dwp)
// has its OWN routes (e.g. `/my-team`) that sico can't name at the type
// level. So instead of the app hand-rolling sico's pill/rail chrome, it
// passes plain DATA shaped like this and sico renders it through the same
// `<NavItem>`/`<RailNavItem>` — the app owns only the route string + icon,
// sico owns the look. Each sidebar variant maps over the downstream items
// after its built-in rows; `useActiveNav().isActive` drives the highlight.
export type NavItemData = {
  // Destination path. sico does not validate it — the consuming app's router
  // resolves it. The runtime guard against dangerous URIs (`javascript:`,
  // `data:`) is TanStack Link's protocol allowlist (http/https/mailto/tel),
  // which must not be widened or overridden. Keep `to` a developer-controlled
  // route literal, never a value sourced from network/user input. Also the
  // React `key` in the extras list, so it must be unique among `extraNavItems`
  // and must not collide with the built-in `/digital-worker` or `/project`.
  readonly to: string;
  readonly label: string;
  readonly icon: ReactNode;
};
