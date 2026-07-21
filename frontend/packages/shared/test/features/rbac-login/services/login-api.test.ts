import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginApi } from "@/features/rbac-login/services/login-api";
import { logger } from "@/utils/logger";

describe("loginApi", () => {
  const instance = axios.create({ baseURL: "/api/sico" });
  let mock: MockAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mock = new MockAdapter(instance);
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  it("unwraps envelope.data on code === 0 and validates with schema", async () => {
    mock.onPost("/rbac/login").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
        user: {
          id: 1,
          email: "a@b.co",
          roles: [
            {
              id: 1,
              roleCode: "project_admin",
              scopeType: "project",
              scopeId: 1,
            },
          ],
        },
      },
    });

    const data = await loginApi(instance, {
      email: "a@b.co",
      password: "123456",
    });

    expect(data.tokenInfo.accessToken).toBe("tok");
    expect(data.user.id).toBe(1);
  });

  // Regression — dogfood QA Round 1 FIND-1 (qa.md §W2). Live backend
  // emits `user.roles: null` for newly-seeded accounts with no roles
  // assigned. `loginApi` must resolve successfully and the user's
  // `roles` must be coerced to `[]` by the schema.
  it("resolves and coerces user.roles=null to [] on success", async () => {
    mock.onPost("/rbac/login").reply(200, {
      code: 0,
      msg: "success",
      data: {
        tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
        user: {
          id: 1,
          email: "operator@sico.local",
          roles: null,
        },
      },
    });

    const data = await loginApi(instance, {
      email: "operator@sico.local",
      password: "operator",
    });

    expect(data.user.roles).toEqual([]);
  });

  it("throws { kind: 'credentials' } on envelope.code !== 0", async () => {
    mock.onPost("/rbac/login").reply(200, {
      code: 40001,
      msg: "incorrect password",
      data: null,
    });

    await expect(
      loginApi(instance, { email: "a@b.co", password: "wrong-pw" }),
    ).rejects.toMatchObject({
      kind: "credentials",
      code: 40001,
    });
  });

  // Regression — dogfood QA Round 1 FIND-2 (qa.md §W3). Live backend
  // credential-failure shape is a bare `{code, msg}` envelope with no
  // `data` key. Prior contract drift (envelope schema required `data`)
  // caused the axios interceptor to swap this for a synthetic
  // network-error envelope, routing `useLogin` to `onNetworkError`.
  // Now: envelope passes parse → `loginApi` throws `LoginCredentialsError`.
  it("throws { kind: 'credentials' } on bare {code, msg} envelope without data", async () => {
    mock.onPost("/rbac/login").reply(200, {
      code: 101008,
      msg: "invalid credentials",
    });

    await expect(
      loginApi(instance, { email: "operator@sico.local", password: "wrong" }),
    ).rejects.toMatchObject({
      kind: "credentials",
      code: 101008,
      msg: "invalid credentials",
    });
  });

  it("throws { kind: 'network' } on schema-incompatible data shape", async () => {
    mock.onPost("/rbac/login").reply(200, {
      code: 0,
      msg: "ok",
      data: { tokenInfo: { accessToken: "tok" }, user: { id: "x" } },
    });

    await expect(
      loginApi(instance, { email: "a@b.co", password: "123456" }),
    ).rejects.toMatchObject({ kind: "network" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("schema parse failed"),
      expect.objectContaining({ issues: expect.any(Array) }),
    );
  });

  it("throws { kind: 'network' } when the envelope carries CLIENT_NETWORK_ERROR_CODE", async () => {
    // Simulates the synthetic envelope that `createApiClient`'s
    // interceptor injects on a real network failure (axios.ts:158-162).
    mock.onPost("/rbac/login").reply(200, {
      code: 600,
      msg: "unknown error",
      data: {},
    });

    await expect(
      loginApi(instance, { email: "a@b.co", password: "123456" }),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("throws { kind: 'network' } when the underlying axios call rejects", async () => {
    // Simulates a bare `axios.create()` instance (no createApiClient
    // interceptor) hitting an unreachable server — axios rejects with
    // a network error and our try/catch must normalise it.
    mock.onPost("/rbac/login").networkError();

    await expect(
      loginApi(instance, { email: "a@b.co", password: "123456" }),
    ).rejects.toMatchObject({ kind: "network" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("axios"),
      expect.objectContaining({ error: expect.anything() }),
    );
  });

  it("logs a warning with 'malformed envelope' label when response data fails envelope schema", async () => {
    mock.onPost("/rbac/login").reply(200, { not: "an envelope" });

    await expect(
      loginApi(instance, { email: "a@b.co", password: "123456" }),
    ).rejects.toMatchObject({ kind: "network" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("malformed envelope"),
      expect.objectContaining({ issues: expect.any(Array) }),
    );
  });
});
