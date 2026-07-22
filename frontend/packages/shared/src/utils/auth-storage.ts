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

// LS side of the auth triple (token + user + expiresAt).
// `atoms/auth-atom.ts` is the jotai surface over these helpers.
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  getItemFromLocalStorage,
  removeItemFromLocalStorage,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
  setItemToLocalStorage,
  USER_MODE_LS,
} from "./local-storage";
import { logger } from "./logger";
import type { LoginMode } from "../components/shell/login-mode-context";
import { type LoginResponse, type User, userSchema } from "../schemas/auth";

export function clearAuthStorage(): void {
  removeItemFromLocalStorage(AUTH_TOKEN_LS);
  removeItemFromLocalStorage(AUTH_USER_LS);
  removeItemFromLocalStorage(AUTH_EXPIRES_AT_LS);
  removeItemFromLocalStorage(USER_MODE_LS);
}

// Returns `null` and clears LS on orphan / expiry / corruption.
// `expiresAt` is epoch-seconds (backend `time.Unix()`), so multiply by
// 1000 before comparing with `Date.now()`.
export function loadFromLS(): User | null {
  const token = getItemFromLocalStorage(AUTH_TOKEN_LS);
  const rawExpiresAt = getItemFromLocalStorage(AUTH_EXPIRES_AT_LS);
  const rawUser = getItemFromLocalStorage(AUTH_USER_LS);
  if (!token || !rawUser || !rawExpiresAt) {
    if (token || rawUser || rawExpiresAt) {
      clearAuthStorage();
    }
    return null;
  }

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
    logger.warn("loadFromLS: stored session has expired or is malformed", {
      expiresAt: rawExpiresAt,
    });
    clearAuthStorage();
    return null;
  }

  const user = safeGetItemFromLocalStorage(AUTH_USER_LS, userSchema);
  if (user === null) {
    clearAuthStorage();
    return null;
  }
  return user;
}

// Sync read for the axios interceptor + TanStack `beforeLoad` (no jotai
// store available pre-mount). Empty-string token collapses to `null`.
export function getAccessToken(): string | null {
  const token = getItemFromLocalStorage(AUTH_TOKEN_LS);
  const rawUser = getItemFromLocalStorage(AUTH_USER_LS);
  const rawExpiresAt = getItemFromLocalStorage(AUTH_EXPIRES_AT_LS);

  if (token === null || token.length === 0) {
    if (token !== null) {
      logger.warn("getAccessToken: empty token; treating as absent");
    }
    return null;
  }

  if (!rawUser || !rawExpiresAt) {
    if (rawUser || rawExpiresAt) {
      clearAuthStorage();
    }
    return null;
  }

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
    logger.warn("getAccessToken: session expired or malformed; clearing LS", {
      expiresAt: rawExpiresAt,
    });
    clearAuthStorage();
    return null;
  }

  return token;
}

export function persistLoginPayload(payload: LoginResponse): void {
  const { tokenInfo, user } = payload;
  setItemToLocalStorage(AUTH_TOKEN_LS, tokenInfo.accessToken);
  safeSetItemToLocalStorage(AUTH_USER_LS, userSchema, user);
  setItemToLocalStorage(AUTH_EXPIRES_AT_LS, String(tokenInfo.expiresAt));
}

// Login mode is a client-side product selection, not a backend role. Any value
// other than the exact string "developer" (absent, "operator", or corrupt)
// collapses to "operator" — the safe default that leaves old sessions on the
// existing workspace. Sync read so the pre-React route guard can use it,
// mirroring `getAccessToken`.
export function getUserMode(): LoginMode {
  return getItemFromLocalStorage(USER_MODE_LS) === "developer"
    ? "developer"
    : "operator";
}

export function setUserMode(mode: LoginMode): void {
  setItemToLocalStorage(USER_MODE_LS, mode);
}
