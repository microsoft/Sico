import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { EnvelopeError } from "@/schemas/api";
import { apiErrorMessage } from "@/utils/api-error-message";

function makeAxiosError(data: unknown): AxiosError {
  return new AxiosError("failed", "ERR", undefined, undefined, {
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
}

describe("apiErrorMessage", () => {
  it("surfaces an EnvelopeError's backend msg", () => {
    const error = new EnvelopeError(
      101_004,
      "role already assigned to user",
      "assignUserRole",
    );
    expect(apiErrorMessage(error, "fallback")).toBe(
      "role already assigned to user",
    );
  });

  it("falls back when an EnvelopeError carries a technical validator msg", () => {
    const error = new EnvelopeError(
      100_001,
      "Key: 'Req.ProjectId' Error:required",
      "ctx",
    );
    expect(apiErrorMessage(error, "fallback")).toBe("fallback");
  });

  it("falls back when an EnvelopeError has an empty msg", () => {
    const error = new EnvelopeError(500, "", "ctx");
    expect(apiErrorMessage(error, "fallback")).toBe("fallback");
  });

  it("surfaces a backend msg from an axios error body", () => {
    const error = makeAxiosError({ code: 112_017, msg: "sandbox is busy" });
    expect(apiErrorMessage(error, "fallback")).toBe("sandbox is busy");
  });

  it("returns the fallback for an unknown error", () => {
    expect(apiErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });
});
