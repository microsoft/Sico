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

import { atom, type PrimitiveAtom } from "jotai";
import { z } from "zod";

import {
  type LocalStorageKey,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
  SIDEBAR_COLLAPSED_LS,
} from "../../../utils/local-storage";

const booleanSchema = z.boolean();

// Boolean atom backed by LocalStorage via the project's zod-validated
// wrapper. Reads lazily on first get so SSR-style imports don't touch
// `localStorage`; writes persist on every set. Supports updater fns
// (`set(atom, prev => !prev)`) to match `PrimitiveAtom<boolean>`.
function persistedBooleanAtom(
  key: LocalStorageKey,
  defaultValue: boolean,
): PrimitiveAtom<boolean> {
  const base = atom<boolean | null>(null);
  const derived = atom(
    (get) => {
      const current = get(base);
      if (current !== null) {
        return current;
      }
      return safeGetItemFromLocalStorage(key, booleanSchema) ?? defaultValue;
    },
    (get, set, update: boolean | ((prev: boolean) => boolean)) => {
      const prev = get(derived);
      const next = typeof update === "function" ? update(prev) : update;
      set(base, next);
      safeSetItemToLocalStorage(key, booleanSchema, next);
    },
  );
  return derived;
}

export const sidebarCollapsedAtom = persistedBooleanAtom(
  SIDEBAR_COLLAPSED_LS,
  false,
);

// Transient (NON-persisted) collapse override the chat Sidepane raises while it
// is open — the preview takes ~75% of the row, so the nav rail steps aside. Kept
// SEPARATE from `sidebarCollapsedAtom` on purpose: forcing the persisted atom
// would write `true` to localStorage, and a reload-with-pane-open (cleanup never
// runs) would then strand the user's "expanded" preference as "collapsed". This
// atom resets to `false` on every reload, so the persisted preference is never
// corrupted. See `sidebarEffectiveCollapsedAtom`.
export const sidebarForcedCollapsedAtom = atom<boolean>(false);

// What the Sidebar actually renders: the user's persisted preference OR the
// Sidepane's transient force-collapse. Read-only — the two inputs are written
// independently (user toggle vs. Sidepane open/close).
export const sidebarEffectiveCollapsedAtom = atom<boolean>(
  (get) => get(sidebarCollapsedAtom) || get(sidebarForcedCollapsedAtom),
);
