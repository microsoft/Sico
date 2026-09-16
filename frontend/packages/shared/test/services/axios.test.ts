import { readFileSync } from "node:fs";
import path from "node:path";

import MockAdapter from "axios-mock-adapter";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAtom, logoutAtom, userAtom } from "@/atoms/auth-atom";
import { CLIENT_NETWORK_ERROR_CODE, HTTP_UNAUTHORIZED } from "@/constants/http";
import { makeOkEnvelope } from "@/schemas/api";
import { createApiClient } from "@/services/axios";
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  getItemFromLocalStorage,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../helpers/clear-auth-storage";

// `getAccessToken()` requires the full triple — seed all three keys or
// the interceptor skips Authorization.
function seedValidSession(token: string): void {
  setItemToLocalStorage(AUTH_TOKEN_LS, token);
  setItemToLocalStorage(
    AUTH_USER_LS,
    JSON.stringify({ id: "1", email: "a@b.test", roles: [] }),
  );
  // Far-future expiry above the epoch-ms floor.
  setItemToLocalStorage(AUTH_EXPIRES_AT_LS, "9999999999999");
}

const OK_EMPTY = makeOkEnvelope({});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mocks: MockAdapter[] = [];

beforeEach(() => clearAuthStorage());

afterEach(() => {
  for (const mock of mocks) {
    mock.restore();
  }
  mocks.length = 0;
});

describe("axios interceptors", () => {
  it("attaches Authorization: Bearer <token> when token in LS", async () => {
    seedValidSession("tok");
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/api/sico/x/y").reply((config) => {
      // `!` over `?.`: forwarded requests always have headers — `?.`
      // would silently swallow a regression where the interceptor
      // stopped attaching them entirely.
      expect(config.headers!.Authorization).toBe("Bearer tok");
      return [200, OK_EMPTY];
    });
    await api.get("/api/sico/x/y");
  });

  it("preserves an explicit same-origin Authorization header", async () => {
    seedValidSession("token-b");
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/explicit-owner").reply((config) => {
      expect(config.headers?.Authorization).toBe("Bearer token-a");
      return [200, OK_EMPTY];
    });

    await api.get("/explicit-owner", {
      headers: { Authorization: "Bearer token-a" },
    });
  });

  it("omits Authorization when no token", async () => {
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/x").reply((config) => {
      expect(config.headers!.Authorization).toBeUndefined();
      return [200, OK_EMPTY];
    });
    await api.get("/x");
  });

  it("synthesizes {code:600,...} on network failure", async () => {
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/down").networkError();
    const res = await api.get("/down");
    expect(res.data).toEqual({
      code: CLIENT_NETWORK_ERROR_CODE,
      msg: "unknown error",
      data: {},
    });
  });

  it("synthesizes {code:600,...} on zod safeParse failure", async () => {
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/bad").reply(200, { not: "an envelope" });
    const res = await api.get("/bad");
    expect(res.data).toEqual({
      code: CLIENT_NETWORK_ERROR_CODE,
      msg: "unknown error",
      data: {},
    });
  });

  it("on 401 clears LS, sets userAtom null, calls onUnauthorized hook", async () => {
    setItemToLocalStorage(AUTH_TOKEN_LS, "tok");
    const onUnauthorized = vi.fn();
    const store = createStore();
    store.set(loginAtom, {
      tokenInfo: {
        accessToken: "tok",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      },
      user: { id: 1, email: "a@b.test", roles: [] },
    });
    const api = createApiClient({ onUnauthorized, store });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/protected").reply(HTTP_UNAUTHORIZED);
    await api.get("/protected");
    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledWith({
      code: HTTP_UNAUTHORIZED,
      url: "/protected",
    });
    expect(store.get(userAtom)).toBeNull();
  });

  it("ignores a late protected 401 after auth was already cleared", async () => {
    const onUnauthorized = vi.fn();
    const store = createStore();
    store.set(loginAtom, {
      tokenInfo: {
        accessToken: "tok",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      },
      user: { id: 1, email: "a@b.test", roles: [] },
    });
    const api = createApiClient({ onUnauthorized, store });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    const requestStarted = deferred<void>();
    const lateResponse = deferred<[number]>();
    mock.onGet("/protected").reply(async () => {
      requestStarted.resolve();
      return lateResponse.promise;
    });

    const pending = api.get("/protected");
    await requestStarted.promise;
    store.set(logoutAtom);
    lateResponse.resolve([HTTP_UNAUTHORIZED]);
    const response = await pending;

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(store.get(userAtom)).toBeNull();
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    expect(response.data).toEqual({
      code: HTTP_UNAUTHORIZED,
      msg: "unauthorized",
      data: {},
    });
  });

  it("does not apply session A's late 401 to a new session B", async () => {
    const onUnauthorized = vi.fn();
    const store = createStore();
    store.set(loginAtom, {
      tokenInfo: {
        accessToken: "token-a",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      },
      user: { id: 1, email: "a@b.test", roles: [] },
    });
    const api = createApiClient({ onUnauthorized, store });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    const requestStarted = deferred<void>();
    const lateResponse = deferred<[number]>();
    mock.onGet("/protected").reply(async (config) => {
      expect(config.headers?.Authorization).toBe("Bearer token-a");
      requestStarted.resolve();
      return lateResponse.promise;
    });

    const pending = api.get("/protected");
    await requestStarted.promise;
    store.set(logoutAtom);
    store.set(loginAtom, {
      tokenInfo: {
        accessToken: "token-b",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      },
      user: { id: 2, email: "b@b.test", roles: [] },
    });
    lateResponse.resolve([HTTP_UNAUTHORIZED]);
    const response = await pending;

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBe("token-b");
    expect(store.get(userAtom)).toEqual({
      id: 2,
      email: "b@b.test",
      roles: [],
    });
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    expect(response.data).toEqual({
      code: HTTP_UNAUTHORIZED,
      msg: "unauthorized",
      data: {},
    });
  });

  it("preserves unauthorized handling for clients without a store", async () => {
    const onUnauthorized = vi.fn();
    const api = createApiClient({ onUnauthorized });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/protected").reply(HTTP_UNAUTHORIZED);

    const response = await api.get("/protected");

    expect(onUnauthorized).toHaveBeenCalledWith({
      code: HTTP_UNAUTHORIZED,
      url: "/protected",
    });
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    expect(response.data).toEqual({
      code: HTTP_UNAUTHORIZED,
      msg: "unauthorized",
      data: {},
    });
  });

  it("never reads tokenInfo.expiresAt (no timer scheduled, no LS read for expiresAt)", () => {
    // process.cwd() because jsdom rewrites import.meta.url to http://localhost.
    const src = readFileSync(
      path.resolve(process.cwd(), "src/services/axios.ts"),
      "utf8",
    );
    expect(src).not.toContain("expiresAt");
  });

  it.each(["get", "post"] as const)(
    "attaches the bound organization to %s requests",
    async (method) => {
      const api = createApiClient({ getOrganizationId: () => 9 });
      const mock = new MockAdapter(api);
      mocks.push(mock);
      mock.onAny("/organization-probe").reply((config) => {
        expect(config.headers?.["X-Sico-Organization-ID"]).toBe("9");
        return [200, OK_EMPTY];
      });

      await api.request({ url: "/organization-probe", method });
    },
  );

  it("attaches the organization without changing a multipart upload body", async () => {
    const api = createApiClient({ getOrganizationId: () => 9 });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    const body = new FormData();
    body.append("file", new File(["content"], "attachment.txt"));
    mock.onPost("/upload").reply((config) => {
      expect(config.headers?.["X-Sico-Organization-ID"]).toBe("9");
      expect(config.data).toBe(body);
      return [200, OK_EMPTY];
    });

    await api.post("/upload", body);
  });

  it("reads the latest organization on every request", async () => {
    let organizationId: number | null = 9;
    const api = createApiClient({ getOrganizationId: () => organizationId });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/organization-probe").reply((config) => {
      expect(config.headers?.["X-Sico-Organization-ID"]).toBe(
        organizationId === null ? undefined : String(organizationId),
      );
      return [200, OK_EMPTY];
    });

    await api.get("/organization-probe");
    organizationId = 10;
    await api.get("/organization-probe");
    organizationId = null;
    await api.get("/organization-probe");
  });

  it("omits the organization before binding is known", async () => {
    const api = createApiClient({ getOrganizationId: () => null });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/organization-probe").reply((config) => {
      expect(config.headers?.["X-Sico-Organization-ID"]).toBeUndefined();
      return [200, OK_EMPTY];
    });

    await api.get("/organization-probe");
  });

  it("attaches the organization even with an explicit Authorization header", async () => {
    const api = createApiClient({ getOrganizationId: () => 9 });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/explicit-owner").reply((config) => {
      expect(config.headers?.Authorization).toBe("Bearer explicit-token");
      expect(config.headers?.["X-Sico-Organization-ID"]).toBe("9");
      return [200, OK_EMPTY];
    });

    await api.get("/explicit-owner", {
      headers: { Authorization: "Bearer explicit-token" },
    });
  });

  it("uses the bound organization instead of an explicit stale organization", async () => {
    const api = createApiClient({ getOrganizationId: () => 9 });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/organization-probe").reply((config) => {
      expect(config.headers?.["x-sico-organization-id"]).toBe("9");
      return [200, OK_EMPTY];
    });

    await api.get("/organization-probe", {
      headers: { "x-sico-organization-id": "8" },
    });
  });

  it("attaches the organization to absolute same-origin URLs", async () => {
    const api = createApiClient({ getOrganizationId: () => 9 });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    const url = `${window.location.origin}/api/sico/probe`;
    mock.onGet(url).reply((config) => {
      expect(config.headers?.["X-Sico-Organization-ID"]).toBe("9");
      return [200, OK_EMPTY];
    });

    await api.get(url);
  });

  it.each([
    { url: "https://other.example/probe", baseURL: "/api/sico" },
    { url: "/probe", baseURL: "https://other.example" },
  ])(
    "omits organization context for cross-origin requests: %o",
    async (request) => {
      const getOrganizationId = vi.fn(() => 9);
      const api = createApiClient({
        baseURL: request.baseURL,
        getOrganizationId,
      });
      const mock = new MockAdapter(api);
      mocks.push(mock);
      mock.onGet(request.url).reply((config) => {
        expect(config.headers?.["X-Sico-Organization-ID"]).toBeUndefined();
        return [200, OK_EMPTY];
      });

      await api.get(request.url);

      expect(getOrganizationId).not.toHaveBeenCalled();
    },
  );

  // --- baseURL / same-origin Authorization regressions --------------------

  it("applies the `baseURL` option to outgoing requests", async () => {
    const api = createApiClient({ baseURL: "/api/sico" });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    let observedUrl = "";
    mock.onGet(/.*\/probe$/).reply((config) => {
      observedUrl = `${config.baseURL ?? ""}${config.url ?? ""}`;
      return [200, OK_EMPTY];
    });
    await api.get("/probe");
    expect(observedUrl).toBe("/api/sico/probe");
  });

  it("does not treat a cross-origin 401 as SICO unauthorized", async () => {
    const onUnauthorized = vi.fn();
    const api = createApiClient({ onUnauthorized });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("https://other.example/protected").reply(HTTP_UNAUTHORIZED);

    const response = await api.get("https://other.example/protected");

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(response.status).toBe(HTTP_UNAUTHORIZED);
    expect(response.data).toEqual({
      code: HTTP_UNAUTHORIZED,
      msg: "unauthorized",
      data: {},
    });
  });

  it("normalizes an empty same-origin token when handling 401", async () => {
    setItemToLocalStorage(AUTH_TOKEN_LS, "");
    const onUnauthorized = vi.fn();
    const api = createApiClient({ onUnauthorized });
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("/protected").reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined();
      return [HTTP_UNAUTHORIZED];
    });

    await api.get("/protected");

    expect(onUnauthorized).toHaveBeenCalledWith({
      code: HTTP_UNAUTHORIZED,
      url: "/protected",
    });
  });

  it("does NOT attach Authorization to absolute cross-origin URLs", async () => {
    seedValidSession("tok");
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    mock.onGet("https://evil.example.com/leak").reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined();
      return [200, OK_EMPTY];
    });
    await api.get("https://evil.example.com/leak");
  });

  it("DOES attach Authorization to absolute same-origin URLs", async () => {
    // jsdom defaults `window.location.origin` to `http://localhost:3000`.
    seedValidSession("tok");
    const api = createApiClient();
    const mock = new MockAdapter(api);
    mocks.push(mock);
    const absoluteSameOrigin = `${window.location.origin}/api/sico/x`;
    mock.onGet(absoluteSameOrigin).reply((config) => {
      expect(config.headers?.Authorization).toBe("Bearer tok");
      return [200, OK_EMPTY];
    });
    await api.get(absoluteSameOrigin);
  });
});
