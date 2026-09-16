import {
  type ApiResponse,
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  CLIENT_NETWORK_ERROR_CODE,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
  logoutAtom,
  userAtom,
} from "@sico/shared";
import { selectedOrganizationIdAtom } from "@sico/shared/features/organization/atoms/selected-organization-atom.ts";
import { organizationKeys } from "@sico/shared/features/organization/query-keys.ts";
import { type OrganizationSummary } from "@sico/shared/features/organization/schemas/organization.ts";
import { setItemToLocalStorage } from "@sico/shared/utils/local-storage.ts";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/services/api";
import { queryClient } from "@/services/query-client";
import { store } from "@/store";

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

function makeOrganization(id: number): OrganizationSummary {
  return {
    id,
    name: `Organization ${id}`,
    description: "",
    createdAt: 1,
    updatedAt: 1,
    creatorUsername: "owner@example.test",
    roleCodes: [],
    isOwner: false,
  };
}

let lastAuthHeader: string | null = null;
let lastOrganizationHeader: string | null = null;

const server = setupMswServer([
  http.get(HANDLER_URL, ({ request }) => {
    lastAuthHeader = request.headers.get("Authorization");
    lastOrganizationHeader = request.headers.get("X-Sico-Organization-ID");
    return HttpResponse.json({ code: HTTP_OK, msg: "", data: { ok: true } });
  }),
]);

describe("@sico/app `api` singleton behaviour", () => {
  beforeEach(() => {
    lastAuthHeader = null;
    lastOrganizationHeader = null;
    clearAuthStorage();
    store.set(userAtom, null);
    store.set(selectedOrganizationIdAtom, null);
    queryClient.clear();
  });

  afterEach(() => {
    clearAuthStorage();
    store.set(userAtom, null);
    store.set(selectedOrganizationIdAtom, null);
    queryClient.clear();
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

  it("uses the default bound organization without a saved preference", async () => {
    store.set(userAtom, { id: 1, email: "u@example.test", roles: [] });
    queryClient.setQueryData(organizationKeys.userOrganizations(1), [
      makeOrganization(9),
    ]);

    await api.get(CALL_PATH);

    expect(lastOrganizationHeader).toBe("9");
  });

  it("uses a new selection on the next request", async () => {
    store.set(userAtom, { id: 1, email: "u@example.test", roles: [] });
    queryClient.setQueryData(organizationKeys.userOrganizations(1), [
      makeOrganization(9),
      makeOrganization(10),
    ]);
    await api.get(CALL_PATH);
    store.set(selectedOrganizationIdAtom, 10);

    await api.get(CALL_PATH);

    expect(lastOrganizationHeader).toBe("10");
  });

  it("does not send an unverified preference before the user's organizations load", async () => {
    store.set(userAtom, { id: 1, email: "u@example.test", roles: [] });
    store.set(selectedOrganizationIdAtom, 9);

    await api.get(CALL_PATH);

    expect(lastOrganizationHeader).toBeNull();
  });

  it("does not reuse the previous user's organization cache", async () => {
    store.set(userAtom, { id: 1, email: "u@example.test", roles: [] });
    queryClient.setQueryData(organizationKeys.userOrganizations(1), [
      makeOrganization(9),
    ]);
    await api.get(CALL_PATH);
    store.set(userAtom, { id: 2, email: "other@example.test", roles: [] });

    await api.get(CALL_PATH);

    expect(lastOrganizationHeader).toBeNull();
  });

  it("omits the organization after logout with cached organizations", async () => {
    store.set(userAtom, { id: 1, email: "u@example.test", roles: [] });
    queryClient.setQueryData(organizationKeys.userOrganizations(1), [
      makeOrganization(9),
    ]);
    await api.get(CALL_PATH);
    store.set(logoutAtom);

    await api.get(CALL_PATH);

    expect(lastOrganizationHeader).toBeNull();
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
