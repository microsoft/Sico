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
