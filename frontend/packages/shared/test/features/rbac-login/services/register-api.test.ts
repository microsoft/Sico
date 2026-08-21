import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerApi } from "@/features/rbac-login/services/register-api";
import { logger } from "@/utils/logger";

describe("registerApi", () => {
  const instance = axios.create({ baseURL: "/api/sico" });
  const values = { email: "person@example.com", password: "12345678" };
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(instance);
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  it("posts only email and password and returns the validated user id", async () => {
    mock.onPost("/rbac/user").reply(200, {
      code: 0,
      msg: "ok",
      data: { id: 77 },
    });

    await expect(registerApi(instance, values)).resolves.toEqual({
      id: 77,
    });
    const request = mock.history.post.at(0);
    expect(request).toBeDefined();
    if (!request || typeof request.data !== "string") {
      throw new Error("Expected a serialized registration request");
    }
    expect(JSON.parse(request.data)).toEqual(values);
  });

  it("classifies a non-zero business envelope as rejected", async () => {
    mock.onPost("/rbac/user").reply(200, {
      code: 101009,
      msg: "email already exists",
    });

    await expect(registerApi(instance, values)).rejects.toMatchObject({
      kind: "rejected",
      code: 101009,
      msg: "email already exists",
    });
  });

  it("classifies synthetic network envelopes as network errors", async () => {
    mock.onPost("/rbac/user").reply(200, {
      code: 600,
      msg: "unknown error",
      data: {},
    });

    await expect(registerApi(instance, values)).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("classifies rejected Axios requests as network errors", async () => {
    mock.onPost("/rbac/user").networkError();

    await expect(registerApi(instance, values)).rejects.toMatchObject({
      kind: "network",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "registerApi: axios request rejected",
      expect.objectContaining({ error: expect.anything() }),
    );
  });

  it("classifies malformed envelopes as network errors", async () => {
    mock.onPost("/rbac/user").reply(200, { unexpected: true });

    await expect(registerApi(instance, values)).rejects.toMatchObject({
      kind: "network",
    });
  });

  it.each([{ data: {} }, { data: { id: "" } }])(
    "classifies an invalid success payload as a network error",
    async ({ data }) => {
      mock.onPost("/rbac/user").reply(200, { code: 0, msg: "ok", data });

      await expect(registerApi(instance, values)).rejects.toMatchObject({
        kind: "network",
      });
    },
  );
});
