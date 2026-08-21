import { describe, expect, it } from "vitest";

import { CLIENT_NETWORK_ERROR_CODE } from "@/constants/http";
import { synthesizeNetworkError } from "@/services/synthesize-error";

describe("synthesizeNetworkError", () => {
  it("returns a CLIENT_NETWORK_ERROR_CODE envelope with the default message", () => {
    const error = synthesizeNetworkError();
    expect(error.code).toBe(CLIENT_NETWORK_ERROR_CODE);
    expect(error.msg).toBe("unknown error");
    expect(error.data).toEqual({});
  });

  it("accepts an optional `msg` override", () => {
    const error = synthesizeNetworkError("ENOTFOUND api.example.test");
    expect(error.code).toBe(CLIENT_NETWORK_ERROR_CODE);
    expect(error.msg).toBe("ENOTFOUND api.example.test");
    expect(error.data).toEqual({});
  });

  it("falls back to the default when override is an empty string", () => {
    // Empty-string would render as a blank toast — fall back to default.
    const error = synthesizeNetworkError("");
    expect(error.msg).toBe("unknown error");
  });
});
