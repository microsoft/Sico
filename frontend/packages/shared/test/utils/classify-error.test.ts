import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { EnvelopeError } from "@/schemas/api";
import { classifyError } from "@/utils/classify-error";

describe("classifyError", () => {
  it("buckets a ZodError as schema", () => {
    expect(classifyError(new ZodError([]))).toBe("schema");
  });

  it("buckets a non-OK envelope (EnvelopeError) as server", () => {
    expect(classifyError(new EnvelopeError(500, "boom", "ctx"))).toBe("server");
  });

  it("buckets a 5xx axios response as server", () => {
    const error = new AxiosError("fail");
    error.response = { status: 503 } as never;
    expect(classifyError(error)).toBe("server");
  });

  it("buckets an unknown Error as unknown", () => {
    expect(classifyError(new Error("boom"))).toBe("unknown");
  });
});
