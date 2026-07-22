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
