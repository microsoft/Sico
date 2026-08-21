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
