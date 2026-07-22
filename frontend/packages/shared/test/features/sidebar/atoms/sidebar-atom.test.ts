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

import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import { sidebarCollapsedAtom } from "@/features/sidebar/atoms/sidebar-atom";
import {
  getItemFromLocalStorage,
  setItemToLocalStorage,
  SIDEBAR_COLLAPSED_LS,
} from "@/utils/local-storage";

describe("sidebarCollapsedAtom", () => {
  beforeEach(() => {
    // eslint-disable-next-line no-restricted-syntax -- per-test reset, parallel to setup.ts
    localStorage.clear();
  });

  it("defaults to false (expanded) when storage is empty", () => {
    const store = createStore();
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });

  it("set is reflected on read", () => {
    const store = createStore();
    store.set(sidebarCollapsedAtom, true);
    expect(store.get(sidebarCollapsedAtom)).toBe(true);
  });

  it("persists to localStorage so a new store reads the prior value", () => {
    const a = createStore();
    a.set(sidebarCollapsedAtom, true);
    expect(getItemFromLocalStorage(SIDEBAR_COLLAPSED_LS)).toBe("true");

    const b = createStore();
    expect(b.get(sidebarCollapsedAtom)).toBe(true);
  });

  it("ignores corrupt localStorage values and falls back to default", () => {
    setItemToLocalStorage(SIDEBAR_COLLAPSED_LS, "not-a-bool");
    const store = createStore();
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });
});
