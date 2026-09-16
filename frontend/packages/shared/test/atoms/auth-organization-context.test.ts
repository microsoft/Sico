import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAtom, logoutAtom, userAtom } from "@/atoms/auth-atom";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import {
  clearAuthStorage,
  getAccessToken,
  loadFromLS,
  persistLoginPayload,
} from "@/utils/auth-storage";
import * as storage from "@/utils/local-storage";
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  getItemFromLocalStorage,
  ORGANIZATION_CONTEXT_LS,
  removeItemFromLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import {
  makeLoginPayload,
  makeOrganization,
} from "../helpers/organization-context";

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  clearAuthStorage();
  store = createStore();
  store.set(loginAtom, makeLoginPayload());
  store.set(selectedOrganizationIdAtom, 9);
  setItemToLocalStorage(
    ORGANIZATION_CONTEXT_LS,
    JSON.stringify({
      version: 1,
      userId: 7,
      organizations: [makeOrganization()],
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAuthStorage();
});

function expectOrganizationStorageCleared(): void {
  expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).toBeNull();
  expect(getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS)).toBeNull();
}

describe("auth organization context lifecycle", () => {
  it("clears credentials, user and selection when storage writes exceed quota", () => {
    removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    expect(() => store.set(logoutAtom)).not.toThrow();

    expect(store.get(userAtom)).toBeNull();
    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_USER_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBeNull();
    expectOrganizationStorageCleared();
  });

  it("clears credentials and memory when optional cache removal fails", () => {
    const removeItem = storage.removeItemFromLocalStorage;
    vi.spyOn(storage, "removeItemFromLocalStorage").mockImplementation(
      (key) => {
        if (key === ORGANIZATION_CONTEXT_LS) {
          throw new DOMException("Storage blocked", "SecurityError");
        }
        removeItem(key);
      },
    );

    expect(() => store.set(logoutAtom)).not.toThrow();

    expect(store.get(userAtom)).toBeNull();
    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_USER_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBeNull();
    expect(getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS)).toBeNull();
  });

  it("clears both organization storage entries on logout", () => {
    store.set(logoutAtom);
    expectOrganizationStorageCleared();
  });

  it("resets a loaded in-memory selection on logout", () => {
    store.set(logoutAtom);
    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
  });

  it.each([7, 8])(
    "clears both storage entries and memory when logging in as user %s",
    (userId) => {
      store.set(loginAtom, makeLoginPayload(userId, "replacement-session"));
      expectOrganizationStorageCleared();
      expect(store.get(selectedOrganizationIdAtom)).toBeNull();
    },
  );

  it("clears organization context when writing a replacement user", () => {
    store.set(userAtom, makeLoginPayload(8).user);
    expectOrganizationStorageCleared();
    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
  });

  it("clears organization context when the user atom becomes unauthenticated", () => {
    store.set(userAtom, null);
    expectOrganizationStorageCleared();
    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
  });

  it("keeps organization context for a same-user profile update", () => {
    store.set(userAtom, { ...makeLoginPayload().user, username: "New name" });
    expect(store.get(selectedOrganizationIdAtom)).toBe(9);
    expect(getItemFromLocalStorage(ORGANIZATION_CONTEXT_LS)).not.toBeNull();
  });

  it("clears both organization entries via clearAuthStorage", () => {
    clearAuthStorage();
    expectOrganizationStorageCleared();
  });

  it("clears organization storage when persisting a new login", () => {
    persistLoginPayload(makeLoginPayload(8));
    expectOrganizationStorageCleared();
  });

  it.each([loadFromLS, getAccessToken])(
    "clears organization storage on expired auth detected by %s",
    (readAuth) => {
      setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "1");
      expect(readAuth()).toBeNull();
      expectOrganizationStorageCleared();
    },
  );
});
