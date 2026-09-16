// `userAtom`'s LS read happens at first `store.get(userAtom)`, not at
// module-import time — tests pre-seed LS after import and still see the
// initial value.
import { type Atom, atom, type PrimitiveAtom, type WritableAtom } from "jotai";

import { resetSelectedOrganizationIdAtom } from "../features/organization/atoms/selected-organization-atom";
import { loginResponseSchema, type User } from "../schemas/auth";
import {
  clearAuthStorage,
  clearOrganizationStorage,
  loadFromLS,
  persistLoginPayload,
} from "../utils/auth-storage";
import { logger } from "../utils/logger";

const UNSET = Symbol("userAtom.unset");
type Unset = typeof UNSET;

const internalUserAtom: PrimitiveAtom<User | null | Unset> = atom<
  User | null | Unset
>(UNSET);

export const userAtom: WritableAtom<User | null, [User | null], void> = atom(
  (get) => {
    const value = get(internalUserAtom);
    return value === UNSET ? loadFromLS() : value;
  },
  (get, set, next: User | null) => {
    if (get(userAtom)?.id !== next?.id) {
      set(resetSelectedOrganizationIdAtom);
      clearOrganizationStorage();
    }
    set(internalUserAtom, next);
  },
);

export const loginAtom: WritableAtom<null, [unknown], void> = atom(
  null,
  (_get, set, payload: unknown) => {
    const result = loginResponseSchema.safeParse(payload);
    if (!result.success) {
      logger.error("loginAtom: invalid login response payload", result.error);
      return;
    }
    set(resetSelectedOrganizationIdAtom);
    persistLoginPayload(result.data);
    set(internalUserAtom, result.data.user);
  },
);

export const logoutAtom: WritableAtom<null, [], void> = atom(
  null,
  (_get, set) => {
    set(resetSelectedOrganizationIdAtom);
    clearAuthStorage();
    set(internalUserAtom, null);
  },
);

export const isAuthenticatedAtom: Atom<boolean> = atom(
  (get) => get(userAtom) !== null,
);
