import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  logoutAtom,
} from "@sico/shared";
import {
  getItemFromLocalStorage,
  setItemToLocalStorage,
} from "@sico/shared/utils/local-storage.ts";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { router } from "@/router";
import { api } from "@/services/api";
import { store } from "@/store";

import { clearAuthStorage } from "../_helpers/clear-auth-storage";
import { setupMswServer } from "../_helpers/msw-server";

// 401 on a protected endpoint drives `logoutAtom` + `onUnauthorized`
// and resolves to a synthetic 401 envelope.
setupMswServer([
  http.get("/api/sico/protected", () =>
    HttpResponse.json(
      { code: 401, msg: "unauthorized", data: {} },
      { status: 401 },
    ),
  ),
]);

describe("401 → /login redirect flow", () => {
  beforeEach(async () => {
    // Mirror prod handshake: full triple → request → 401 → logout clears all three.
    clearAuthStorage();
    setItemToLocalStorage(AUTH_TOKEN_LS, "fake-token");
    setItemToLocalStorage(
      AUTH_USER_LS,
      JSON.stringify({ id: 1, email: "u@example.test", roles: [] }),
    );
    // Far-future expiry above the epoch-ms floor.
    setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");
    await router.navigate({ to: "/digital-worker" });
  });

  afterEach(() => {
    store.set(logoutAtom);
  });

  it("clears LS and redirects to /login?code=401&next=/digital-worker", async () => {
    // Wire URL resolves to `/api/sico/protected` via api baseURL.
    await api.get("/protected");

    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBeNull();
    // Pin the full clear — dropping only the token must trip this.
    expect(getItemFromLocalStorage(AUTH_USER_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBeNull();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toMatchObject({
      code: 401,
      next: "/digital-worker",
    });
  });
});
