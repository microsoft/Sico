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

import { beforeEach, describe, expect, it } from "vitest";

import { getUserMode, setUserMode } from "@/utils/auth-storage";
import {
  getItemFromLocalStorage,
  setItemToLocalStorage,
  USER_MODE_LS,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../helpers/clear-auth-storage";

// `sico.userMode` is a client-side product selection with a safe operator
// default; these pin the read validation + write roundtrip + clear behavior.
beforeEach(() => {
  clearAuthStorage();
});

describe("getUserMode", () => {
  it("returns operator when no mode is stored", () => {
    expect(getUserMode()).toBe("operator");
  });

  it("returns developer only for the exact string 'developer'", () => {
    setItemToLocalStorage(USER_MODE_LS, "developer");
    expect(getUserMode()).toBe("developer");
  });

  it("returns operator for the stored 'operator' value", () => {
    setItemToLocalStorage(USER_MODE_LS, "operator");
    expect(getUserMode()).toBe("operator");
  });

  it("collapses a corrupt value to operator", () => {
    setItemToLocalStorage(USER_MODE_LS, "super-admin");
    expect(getUserMode()).toBe("operator");
  });
});

describe("setUserMode", () => {
  it("writes the raw mode string and reads back", () => {
    setUserMode("developer");
    expect(getItemFromLocalStorage(USER_MODE_LS)).toBe("developer");
    expect(getUserMode()).toBe("developer");
  });

  it("is cleared by clearAuthStorage", () => {
    setUserMode("developer");
    clearAuthStorage();
    expect(getItemFromLocalStorage(USER_MODE_LS)).toBeNull();
    expect(getUserMode()).toBe("operator");
  });
});
