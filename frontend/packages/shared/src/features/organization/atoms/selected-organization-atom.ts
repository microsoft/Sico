import { atom } from "jotai";
import { z } from "zod";

import {
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
} from "../../../utils/local-storage";

const organizationIdSchema = z.number().int().positive().nullable();
const internalSelectedOrganizationIdAtom = atom<number | null | undefined>(
  undefined,
);

// Auth transitions remove storage separately; clearing memory must not allocate in LS.
export const resetSelectedOrganizationIdAtom = atom(null, (_get, set) => {
  set(internalSelectedOrganizationIdAtom, null);
});

export const selectedOrganizationIdAtom = atom<
  number | null,
  [number | null],
  void
>(
  (get) => {
    const current = get(internalSelectedOrganizationIdAtom);
    return current === undefined
      ? safeGetItemFromLocalStorage(
          SELECTED_ORGANIZATION_ID_LS,
          organizationIdSchema,
        )
      : current;
  },
  (_get, set, organizationId) => {
    safeSetItemToLocalStorage(
      SELECTED_ORGANIZATION_ID_LS,
      organizationIdSchema,
      organizationId,
    );
    set(internalSelectedOrganizationIdAtom, organizationId);
  },
);
