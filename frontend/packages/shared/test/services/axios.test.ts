import { readFileSync } from "node:fs";
import path from "node:path";

import MockAdapter from "axios-mock-adapter";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAtom, userAtom } from "@/atoms/auth-atom";
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

  it("never reads tokenInfo.expiresAt (no timer scheduled, no LS read for expiresAt)", () => {
    // process.cwd() because jsdom rewrites import.meta.url to http://localhost.
    const src = readFileSync(
      path.resolve(process.cwd(), "src/services/axios.ts"),
      "utf8",
    );
    expect(src).not.toContain("expiresAt");
  });

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
