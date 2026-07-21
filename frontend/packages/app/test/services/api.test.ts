import {
  type ApiResponse,
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  CLIENT_NETWORK_ERROR_CODE,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "@sico/shared";
import { setItemToLocalStorage } from "@sico/shared/utils/local-storage.ts";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/services/api";

import { clearAuthStorage } from "../_helpers/clear-auth-storage";
import { setupMswServer } from "../_helpers/msw-server";

// `api` pins `baseURL: "/api/sico"`, so call-site `/__probe` resolves
// to the wire URL `/api/sico/__probe` (matched by msw below).
const HANDLER_URL = "/api/sico/__probe";
const CALL_PATH = "/__probe";

// `getAccessToken()` enforces the full auth triple (token + user +
// expiresAt) — seed all three so the interceptor attaches the Bearer.
function seedValidSession(token: string): void {
  setItemToLocalStorage(AUTH_TOKEN_LS, token);
  setItemToLocalStorage(
    AUTH_USER_LS,
    JSON.stringify({ id: "1", email: "u@example.test", roles: [] }),
  );
  setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");
}

let lastAuthHeader: string | null = null;

const server = setupMswServer([
  http.get(HANDLER_URL, ({ request }) => {
    lastAuthHeader = request.headers.get("Authorization");
    return HttpResponse.json({ code: HTTP_OK, msg: "", data: { ok: true } });
  }),
]);

describe("@sico/app `api` singleton behaviour", () => {
  beforeEach(() => {
    lastAuthHeader = null;
    clearAuthStorage();
  });

  afterEach(() => {
    clearAuthStorage();
  });

  it("injects Authorization: Bearer <token> when LS has a token", async () => {
    seedValidSession("abc-123");

    const response = await api.get<ApiResponse<{ ok: true }>>(CALL_PATH);

    expect(lastAuthHeader).toBe("Bearer abc-123");
    expect(response.data).toMatchObject({ code: HTTP_OK });
  });

  it("omits the Authorization header when LS has no token", async () => {
    const response = await api.get<ApiResponse<{ ok: true }>>(CALL_PATH);

    expect(lastAuthHeader).toBeNull();
    expect(response.data).toMatchObject({ code: HTTP_OK });
  });

  it("synthesises the CLIENT_NETWORK_ERROR_CODE envelope on network failure", async () => {
    // msw `error()` simulates a fetch failure; the response interceptor
    // maps the AxiosError to a synthetic 600 envelope.
    server.use(http.get(HANDLER_URL, () => HttpResponse.error()));

    const response =
      await api.get<ApiResponse<Record<string, never>>>(CALL_PATH);

    expect(response.data).toMatchObject({
      code: CLIENT_NETWORK_ERROR_CODE,
    });
    expect(response.data.code).not.toBe(HTTP_UNAUTHORIZED);
  });
});
