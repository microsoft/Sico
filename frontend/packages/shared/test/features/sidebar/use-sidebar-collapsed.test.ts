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

import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { describe, expect, it } from "vitest";

import {
  sidebarCollapsedAtom,
  sidebarForcedCollapsedAtom,
} from "@/features/sidebar/atoms/sidebar-atom";
import { useSidebarCollapsed } from "@/features/sidebar/hooks/use-sidebar-collapsed";

// Fresh store per test isolates the module-level singleton atoms.
function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return createElement(Provider, { store }, children);
  };
}

function read(store: ReturnType<typeof createStore>): boolean {
  return renderHook(() => useSidebarCollapsed(), { wrapper: wrapper(store) })
    .result.current;
}

describe("useSidebarCollapsed", () => {
  it("is false when neither the persisted pref nor the force-collapse is set", () => {
    expect(read(createStore())).toBe(false);
  });

  it("is true when the user persisted a collapsed preference", () => {
    const store = createStore();
    store.set(sidebarCollapsedAtom, true);
    expect(read(store)).toBe(true);
  });

  it("is true while only the Sidepane force-collapse is set (persisted pref expanded)", () => {
    // Regression: a downstream menuTopExtras row (dwp Notification) must read the
    // EFFECTIVE state, so a Sidepane-forced collapse switches it to the rail
    // (icon-only) variant. Reading the persisted atom alone would leave it
    // expanded while the Sidebar itself shows the collapsed rail.
    const store = createStore();
    store.set(sidebarCollapsedAtom, false);
    store.set(sidebarForcedCollapsedAtom, true);
    expect(read(store)).toBe(true);
  });
});
