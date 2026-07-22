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

import { useAtomValue } from "jotai";

import { sidebarEffectiveCollapsedAtom } from "../atoms/sidebar-atom";

// Read-only view of the sidebar's EFFECTIVE collapsed state, for downstream apps
// that inject a `menuTopExtras` row needing to switch chrome between the expanded
// (`NavRow`, with label) and collapsed (`RailNavRow`, icon-only) variants. Reads
// the effective atom (persisted preference OR the chat Sidepane's transient
// force-collapse) so an injected row matches the rail the Sidebar actually
// renders — otherwise a Sidepane-forced collapse would leave the row expanded.
// Exposes only the boolean — the atoms stay sidebar-internal so consumers can't
// drive collapse/expand out of band.
export function useSidebarCollapsed(): boolean {
  return useAtomValue(sidebarEffectiveCollapsedAtom);
}
