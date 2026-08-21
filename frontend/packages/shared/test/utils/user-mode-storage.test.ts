import { beforeEach, describe, expect, it } from "vitest";

import { getUserMode, setUserMode } from "@/utils/auth-storage";
import {
  getItemFromLocalStorage,
  setItemToLocalStorage,
  USER_MODE_LS,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../helpers/clear-auth-storage";

// `sico.userMode` is a client-side product selection with a safe operator
// default; these pin the read validation + write roundtrip + clear behavior.
beforeEach(() => {
  clearAuthStorage();
});

describe("getUserMode", () => {
  it("returns operator when no mode is stored", () => {
    expect(getUserMode()).toBe("operator");
  });

  it("returns developer only for the exact string 'developer'", () => {
    setItemToLocalStorage(USER_MODE_LS, "developer");
    expect(getUserMode()).toBe("developer");
  });

  it("returns operator for the stored 'operator' value", () => {
    setItemToLocalStorage(USER_MODE_LS, "operator");
    expect(getUserMode()).toBe("operator");
  });

  it("collapses a corrupt value to operator", () => {
    setItemToLocalStorage(USER_MODE_LS, "super-admin");
    expect(getUserMode()).toBe("operator");
  });
});

describe("setUserMode", () => {
  it("writes the raw mode string and reads back", () => {
    setUserMode("developer");
    expect(getItemFromLocalStorage(USER_MODE_LS)).toBe("developer");
    expect(getUserMode()).toBe("developer");
  });

  it("is cleared by clearAuthStorage", () => {
    setUserMode("developer");
    clearAuthStorage();
    expect(getItemFromLocalStorage(USER_MODE_LS)).toBeNull();
    expect(getUserMode()).toBe("operator");
  });
});
