import { beforeEach, describe, expect, it } from "vitest";

import { getAccessToken, loadFromLS } from "@/utils/auth-storage";
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../helpers/clear-auth-storage";

// Dedicated tests for the seconds-vs-ms expiry comparison in
// `auth-storage.ts`. The schema persists `expiresAt` in epoch-seconds
// (backend `time.Unix()`); these tests pin that `loadFromLS` and
// `getAccessToken` compare against `Date.now()` in the same unit.
beforeEach(() => {
  clearAuthStorage();
});

describe("loadFromLS — epoch-seconds expiresAt", () => {
  it("treats epoch-seconds expiresAt in the future as valid", () => {
    const inOneHourSeconds = Math.floor(Date.now() / 1000) + 3600;
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "a@b.co", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, String(inOneHourSeconds));
    expect(loadFromLS()).not.toBeNull();
  });

  it("treats epoch-seconds expiresAt in the past as expired", () => {
    const oneHourAgoSeconds = Math.floor(Date.now() / 1000) - 3600;
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "a@b.co", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, String(oneHourAgoSeconds));
    expect(loadFromLS()).toBeNull();
  });
});

describe("getAccessToken — epoch-seconds expiresAt", () => {
  it("returns token when epoch-seconds expiresAt is in the future", () => {
    const inOneHourSeconds = Math.floor(Date.now() / 1000) + 3600;
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "a@b.co", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, String(inOneHourSeconds));
    expect(getAccessToken()).toBe("tok");
  });

  it("returns null when epoch-seconds expiresAt is in the past", () => {
    const oneHourAgoSeconds = Math.floor(Date.now() / 1000) - 3600;
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "a@b.co", roles: [] }),
    );
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, String(oneHourAgoSeconds));
    expect(getAccessToken()).toBeNull();
  });
});
