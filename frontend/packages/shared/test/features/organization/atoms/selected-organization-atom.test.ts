import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetSelectedOrganizationIdAtom,
  selectedOrganizationIdAtom,
} from "@/features/organization/atoms/selected-organization-atom";
import {
  getItemFromLocalStorage,
  removeItemFromLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

beforeEach(() => {
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
});

afterEach(() => vi.restoreAllMocks());

describe("selectedOrganizationIdAtom", () => {
  it("resets memory without writing a selection preference", () => {
    const store = createStore();
    store.set(selectedOrganizationIdAtom, 9);
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage full", "QuotaExceededError");
      });

    store.set(resetSelectedOrganizationIdAtom);

    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS)).toBe("9");
  });

  it("defaults to null when no organization is stored", () => {
    expect(createStore().get(selectedOrganizationIdAtom)).toBeNull();
  });

  it("reads storage lazily on the first store read", () => {
    const store = createStore();
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "9");

    expect(store.get(selectedOrganizationIdAtom)).toBe(9);
  });

  it("persists a selection for a new store", () => {
    const store = createStore();
    store.set(selectedOrganizationIdAtom, 9);

    expect(store.get(selectedOrganizationIdAtom)).toBe(9);
    expect(getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS)).toBe("9");
    expect(createStore().get(selectedOrganizationIdAtom)).toBe(9);
  });

  it("replaces a previously persisted selection", () => {
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "9");
    const store = createStore();
    expect(store.get(selectedOrganizationIdAtom)).toBe(9);

    store.set(selectedOrganizationIdAtom, 10);

    expect(store.get(selectedOrganizationIdAtom)).toBe(10);
    expect(createStore().get(selectedOrganizationIdAtom)).toBe(10);
  });

  it("persists null when the selection is cleared", () => {
    const store = createStore();
    store.set(selectedOrganizationIdAtom, 9);

    store.set(selectedOrganizationIdAtom, null);

    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
    expect(getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS)).toBe("null");
    expect(createStore().get(selectedOrganizationIdAtom)).toBeNull();
  });

  it.each(["not-json", "0", "-1", "1.5", '"9"', "true", "{}", "[]"])(
    "falls back to null for invalid stored value %s",
    (value) => {
      setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, value);

      expect(createStore().get(selectedOrganizationIdAtom)).toBeNull();
    },
  );

  it("accepts an explicitly stored null", () => {
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "null");

    expect(createStore().get(selectedOrganizationIdAtom)).toBeNull();
  });
});
