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

import {
  isAuthenticatedAtom,
  loginAtom,
  logoutAtom,
  userAtom,
} from "@/atoms/auth-atom";
import { getAccessToken } from "@/utils/auth-storage";
import {
  getItemFromLocalStorage,
  AUTH_EXPIRES_AT_LS as LS_EXPIRES,
  AUTH_TOKEN_LS as LS_TOKEN,
  AUTH_USER_LS as LS_USER,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../helpers/clear-auth-storage";

// Epoch-seconds — what loginResponseSchema demands and auth-storage.ts now compares.
const FUTURE = (): number => Math.floor(Date.now() / 1000) + 3_600;
const PAST = 0;

beforeEach(() => {
  clearAuthStorage();
});

describe("userAtom", () => {
  it("initializes from LS", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(LS_EXPIRES, String(FUTURE()));
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({
        id: 1,
        email: "a@b.test",
        roles: [
          {
            id: 9,
            roleCode: "project_admin",
            scopeType: "project",
            scopeId: 1,
          },
        ],
      }),
    );
    const store = createStore();
    expect(store.get(userAtom)).toMatchObject({ id: 1 });
    expect(store.get(isAuthenticatedAtom)).toBe(true);
  });

  it("loginAtom writes LS (incl. expiresAt) + sets atom (drops extra user fields)", () => {
    const store = createStore();
    const expires = FUTURE();
    const roles = [
      { id: 9, roleCode: "project_member", scopeType: "project", scopeId: 3 },
    ];
    store.set(loginAtom, {
      tokenInfo: { accessToken: "tok", expiresAt: expires },
      user: { id: 1, email: "a@b.test", roles, extra: "nope" },
    });
    expect(getItemFromLocalStorage(LS_TOKEN)).toBe("tok");
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBe(String(expires));
    // non-null: loginAtom synchronously writes LS_USER above this read
    expect(JSON.parse(getItemFromLocalStorage(LS_USER)!)).toEqual({
      id: 1,
      email: "a@b.test",
      roles,
    });
    expect(store.get(userAtom)).toEqual({
      id: 1,
      email: "a@b.test",
      roles,
    });
  });

  it("logoutAtom clears LS (incl. expiresAt) + atom", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    const store = createStore();
    store.set(loginAtom, {
      tokenInfo: { accessToken: "tok", expiresAt: FUTURE() },
      user: { id: 1, email: "a@b.test", roles: [] },
    });
    store.set(logoutAtom);
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBeNull();
    expect(store.get(userAtom)).toBeNull();
  });

  it("loginAtom ignores malformed payload (no LS or atom mutation)", () => {
    const store = createStore();
    store.set(loginAtom, { not: "a login response" });
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBeNull();
    expect(store.get(userAtom)).toBeNull();
  });

  it("loginAtom does not throw on a missing user field (regression)", () => {
    // The previous impl called `userSchema.parse(user)` after
    // `loginResponseSchema.safeParse(payload)` succeeded — schema drift
    // would throw synchronously into the atom write callback. The fix
    // uses `result.data.user` directly.
    const store = createStore();
    expect(() => {
      store.set(loginAtom, {
        tokenInfo: { accessToken: "tok", expiresAt: FUTURE() },
        user: { id: 1, roles: [] },
      });
    }).not.toThrow();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(store.get(userAtom)).toBeNull();
  });

  it("corrupt LS at init yields null + clears LS", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(LS_EXPIRES, String(FUTURE()));
    setItemToLocalStorage(LS_USER, "{not json");
    const store = createStore();
    expect(store.get(userAtom)).toBeNull();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBeNull();
  });

  // --- expiresAt / session-window regressions -----------------------------

  it("expired session at init yields null + clears LS", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(LS_EXPIRES, String(PAST));
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    const store = createStore();
    expect(store.get(userAtom)).toBeNull();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBeNull();
  });

  it("missing expiresAt at init yields null + clears LS (legacy LS)", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    const store = createStore();
    expect(store.get(userAtom)).toBeNull();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
  });

  it("unparseable expiresAt at init yields null + clears LS", () => {
    // `Number("abc") === NaN`, `Number.isFinite(NaN) === false`.
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(LS_EXPIRES, "not-a-number");
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    const store = createStore();
    expect(store.get(userAtom)).toBeNull();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBeNull();
  });

  // --- getAccessToken() regressions --------------------------------------

  it("getAccessToken returns null when LS triple is missing", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("getAccessToken returns null + clears LS when session expired", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(LS_EXPIRES, String(PAST));
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    expect(getAccessToken()).toBeNull();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
    expect(getItemFromLocalStorage(LS_EXPIRES)).toBeNull();
  });

  it("getAccessToken returns null + clears partial LS triple", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    expect(getAccessToken()).toBeNull();
    expect(getItemFromLocalStorage(LS_TOKEN)).toBeNull();
    expect(getItemFromLocalStorage(LS_USER)).toBeNull();
  });

  it("getAccessToken returns null for empty-string token", () => {
    // Without this gate the interceptor would emit `"Bearer "`.
    setItemToLocalStorage(LS_TOKEN, "");
    setItemToLocalStorage(LS_EXPIRES, String(FUTURE()));
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    expect(getAccessToken()).toBeNull();
  });

  it("getAccessToken returns token on a valid, in-window session", () => {
    setItemToLocalStorage(LS_TOKEN, "tok");
    setItemToLocalStorage(LS_EXPIRES, String(FUTURE()));
    setItemToLocalStorage(
      LS_USER,
      JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
    );
    expect(getAccessToken()).toBe("tok");
  });
});
