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

/* eslint-disable no-console -- spying on console.* to verify the logger sink */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("forwards info/warn/error to console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("@/utils/logger");
    logger.info("hi", { a: 1 });
    logger.warn("uh");
    logger.error("nope");
    expect(info).toHaveBeenCalledWith("hi", { a: 1 });
    expect(warn).toHaveBeenCalledWith("uh");
    expect(error).toHaveBeenCalledWith("nope");
  });

  it("forwards debug to console in non-production", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { logger } = await import("@/utils/logger");
    logger.debug("here");
    expect(debug).toHaveBeenCalledWith("here");
  });

  it("strips debug in production", async () => {
    vi.stubEnv("MODE", "production");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { logger } = await import("@/utils/logger");
    logger.debug("x");
    expect(debug).not.toHaveBeenCalled();
  });

  // Prod must scrub object args — raw payloads can contain tokens,
  // emails, or backend stack traces.
  it("scrubs object arguments in production", async () => {
    vi.stubEnv("MODE", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("@/utils/logger");
    logger.error("zod failed", {
      issues: [{ path: ["accessToken"], message: "Required" }],
      raw: { accessToken: "secret-token-do-not-leak" },
    });
    expect(error).toHaveBeenCalled();
    // `.mock.calls[i]` is typed `any[]`; narrow at the `expect` site.
    const call: unknown[] = error.mock.calls[0] ?? [];
    const [msg, payload] = call;
    expect(msg).toBe("zod failed");
    expect(JSON.stringify(payload)).not.toMatch(/secret-token-do-not-leak/);
  });

  it("keeps raw payloads in non-production for debugability", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("@/utils/logger");
    const payload = { raw: { accessToken: "tok" } };
    logger.error("zod failed", payload);
    expect(error).toHaveBeenCalledWith("zod failed", payload);
  });
});
