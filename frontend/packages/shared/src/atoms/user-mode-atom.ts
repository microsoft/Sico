// Jotai surface over the `sico.userMode` LS key. Mirrors `userAtom`'s
// UNSET-lazy-read pattern: the LS read happens at first `store.get(userModeAtom)`,
// not at import time, so tests can pre-seed LS after import and still see the
// initial value. `resetUserModeAtom` lets `logoutAtom` drop the cached value so
// a logout → re-login in the same session re-reads LS.
import { atom, type PrimitiveAtom, type WritableAtom } from "jotai";

import type { LoginMode } from "../components/shell/login-mode-context";
import { getUserMode, setUserMode } from "../utils/auth-storage";

const UNSET = Symbol("userModeAtom.unset");
type Unset = typeof UNSET;

const internalUserModeAtom: PrimitiveAtom<LoginMode | Unset> = atom<
  LoginMode | Unset
>(UNSET);

export const userModeAtom: WritableAtom<LoginMode, [LoginMode], void> = atom(
  (get) => {
    const value = get(internalUserModeAtom);
    return value === UNSET ? getUserMode() : value;
  },
  (_get, set, next: LoginMode) => {
    setUserMode(next);
    set(internalUserModeAtom, next);
  },
);

export const resetUserModeAtom: WritableAtom<null, [], void> = atom(
  null,
  (_get, set) => {
    set(internalUserModeAtom, UNSET);
  },
);
