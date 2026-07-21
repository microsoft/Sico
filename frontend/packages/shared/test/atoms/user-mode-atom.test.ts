import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import { logoutAtom } from "@/atoms/auth-atom";
import { userModeAtom } from "@/atoms/user-mode-atom";
import {
  getItemFromLocalStorage,
  setItemToLocalStorage,
  USER_MODE_LS,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../helpers/clear-auth-storage";

beforeEach(() => {
  clearAuthStorage();
});

describe("userModeAtom", () => {
  it("defaults to operator when LS is empty", () => {
    const store = createStore();
    expect(store.get(userModeAtom)).toBe("operator");
  });

  it("initializes from LS lazily (seed after import still seen)", () => {
    setItemToLocalStorage(USER_MODE_LS, "developer");
    const store = createStore();
    expect(store.get(userModeAtom)).toBe("developer");
  });

  it("write updates both the atom and LS", () => {
    const store = createStore();
    store.set(userModeAtom, "developer");
    expect(store.get(userModeAtom)).toBe("developer");
    expect(getItemFromLocalStorage(USER_MODE_LS)).toBe("developer");
  });

  it("logout resets the cached mode back to operator", () => {
    const store = createStore();
    store.set(userModeAtom, "developer");
    expect(store.get(userModeAtom)).toBe("developer");

    store.set(logoutAtom);
    expect(store.get(userModeAtom)).toBe("operator");
    expect(getItemFromLocalStorage(USER_MODE_LS)).toBeNull();
  });
});
