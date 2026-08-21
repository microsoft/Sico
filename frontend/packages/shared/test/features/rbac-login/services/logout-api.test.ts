import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logoutApi } from "@/features/rbac-login/services/logout-api";
import { logger } from "@/utils/logger";

describe("logoutApi", () => {
  const instance = axios.create({ baseURL: "/api/sico" });
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(instance);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  it("resolves to void on OK envelope", async () => {
    mock.onPost("/rbac/logout").reply(200, { code: 0, msg: "ok", data: null });

    await expect(logoutApi(instance)).resolves.toBeUndefined();
  });

  it("throws on network failure", async () => {
    mock.onPost("/rbac/logout").networkError();

    await expect(logoutApi(instance)).rejects.toThrow(/network unreachable/);
  });

  it("throws sanitized error on non-OK envelope and logs raw msg", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    mock
      .onPost("/rbac/logout")
      .reply(200, { code: 500, msg: "internal error", data: null });

    await expect(logoutApi(instance)).rejects.toThrow(/server rejected/);
    expect(warnSpy).toHaveBeenCalledWith(
      "logoutApi: server rejected",
      expect.objectContaining({ msg: "internal error", code: 500 }),
    );
  });
});
