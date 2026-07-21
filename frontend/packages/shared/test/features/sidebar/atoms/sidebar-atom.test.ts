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
