import {
  type ApiResponse,
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  loginAtom,
  type LoginResponse,
  logoutAtom,
  resolveLandingPath,
} from "@sico/shared";
import { getItemFromLocalStorage } from "@sico/shared/utils/local-storage.ts";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { router } from "@/router";
import { api } from "@/services/api";
import { store } from "@/store";

import { clearAuthStorage } from "../_helpers/clear-auth-storage";
import { setupMswServer } from "../_helpers/msw-server";

// Each test hits `POST /api/sico/rbac/login` with the real `api` client
// so msw + envelope unwrap + `loginAtom` schema validation run end-to-end.
const mockLoginResponse = {
  tokenInfo: {
    accessToken: "tok",
    expiresAt: Math.floor(Date.now() / 1000) + 3_600,
  },
  user: { id: 1, email: "user@example.com", roles: [] as string[] },
};

// `@sico/app`'s default landing for an unauthenticated bounce.
const DEFAULT_LANDING_PATH = "/digital-worker";

setupMswServer([
  http.post("/api/sico/rbac/login", () =>
    HttpResponse.json({ code: 0, msg: "ok", data: mockLoginResponse }),
  ),
]);

describe("login flow → post-login landing", () => {
  beforeEach(async () => {
    clearAuthStorage();
    await router.navigate({ to: "/login" });
  });

  afterEach(() => {
    // Reset LS + jotai store so the next test's `clearAuthStorage()`
    // doesn't race the atom's lazy-LS read.
    store.set(logoutAtom);
  });

  it("default landing → /digital-worker when next= is absent", async () => {
    // `api` pins `baseURL: "/api/sico"`, so the wire URL resolves to
    // `/api/sico/rbac/login`.
    const response = await api.post<ApiResponse<LoginResponse>>("/rbac/login", {
      email: "user@example.com",
      password: "irrelevant-for-mock",
    });

    store.set(loginAtom, response.data.data);

    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBe("tok");
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBe(
      String(mockLoginResponse.tokenInfo.expiresAt),
    );

    const landing = resolveLandingPath(
      router.state.location.search,
      DEFAULT_LANDING_PATH,
    );
    await router.navigate({ to: landing });

    expect(router.state.location.pathname).toBe("/digital-worker");
  });

  it("honors next= search param → /foo", async () => {
    await router.navigate({
      to: "/login",
      search: { code: 401, next: "/foo" },
    });

    const response = await api.post<ApiResponse<LoginResponse>>("/rbac/login", {
      email: "user@example.com",
      password: "irrelevant-for-mock",
    });
    store.set(loginAtom, response.data.data);

    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBe("tok");
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBe(
      String(mockLoginResponse.tokenInfo.expiresAt),
    );

    const landing = resolveLandingPath(
      router.state.location.search,
      DEFAULT_LANDING_PATH,
    );
    await router.navigate({ to: landing });

    expect(router.state.location.pathname).toBe("/foo");
  });
});
