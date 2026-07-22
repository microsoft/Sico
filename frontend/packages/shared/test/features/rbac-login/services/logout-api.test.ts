/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
