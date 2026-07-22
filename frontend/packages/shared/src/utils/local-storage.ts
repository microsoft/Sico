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

// Single entry point for LocalStorage. Direct `localStorage.*` calls
// are banned via `no-restricted-syntax`. Widen `LocalStorageKey` to
// register a new namespace.
import type { z } from "zod";

import { logger } from "./logger";

// Auth triple — owned as a unit by `utils/auth-storage.ts`.
export const AUTH_TOKEN_LS = "sico.accessToken";
export const AUTH_USER_LS = "sico.user";
export const AUTH_EXPIRES_AT_LS = "sico.expiresAt";

// Login product mode (operator workspace vs developer studio). Selected at
// login, read pre-React by the route guard — owned by `utils/auth-storage.ts`
// alongside the auth triple and cleared with it.
export const USER_MODE_LS = "sico.userMode";

// Sidebar UI preferences.
export const SIDEBAR_COLLAPSED_LS = "sico.sidebarCollapsed";

// Assets-table per-tab definition hints the user dismissed ("don't show again").
export const ASSETS_HINT_DISMISSED_LS = "sico.assetsHintDismissed";

export type LocalStorageKey =
  | typeof AUTH_TOKEN_LS
  | typeof AUTH_USER_LS
  | typeof AUTH_EXPIRES_AT_LS
  | typeof USER_MODE_LS
  | typeof SIDEBAR_COLLAPSED_LS
  | typeof ASSETS_HINT_DISMISSED_LS;

export function getItemFromLocalStorage(key: LocalStorageKey): string | null {
  // eslint-disable-next-line no-restricted-syntax -- canonical wrapper for LocalStorage reads
  return localStorage.getItem(key);
}

export function setItemToLocalStorage(
  key: LocalStorageKey,
  value: string,
): void {
  // eslint-disable-next-line no-restricted-syntax -- canonical wrapper for LocalStorage writes
  localStorage.setItem(key, value);
}

export function removeItemFromLocalStorage(key: LocalStorageKey): void {
  // eslint-disable-next-line no-restricted-syntax -- canonical wrapper for LocalStorage removes
  localStorage.removeItem(key);
}

// Returns `null` (and logs) on absent / JSON-error / schema-mismatch.
// Callers needing to distinguish absent vs corrupt should read first
// via `getItemFromLocalStorage`.
export function safeGetItemFromLocalStorage<Schema extends z.ZodType>(
  key: LocalStorageKey,
  schema: Schema,
): z.infer<Schema> | null {
  const raw = getItemFromLocalStorage(key);
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      logger.error(
        `safeGetItemFromLocalStorage: schema validation failed for key '${key}'`,
        result.error,
      );
      return null;
    }
    return result.data;
  } catch (error) {
    logger.error(
      `safeGetItemFromLocalStorage: JSON.parse failed for key '${key}'`,
      error,
    );
    return null;
  }
}

// Validate before serialise; refuse the write on schema failure.
export function safeSetItemToLocalStorage<Schema extends z.ZodType>(
  key: LocalStorageKey,
  schema: Schema,
  value: z.input<Schema>,
): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    logger.error(
      `safeSetItemToLocalStorage: refused to write invalid value for key '${key}'`,
      result.error,
    );
    return;
  }
  setItemToLocalStorage(key, JSON.stringify(result.data));
}
