import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  CLIENT_NETWORK_ERROR_CODE,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "@/constants/http";
import {
  type ApiResponse,
  apiResponseSchema,
  makeOkEnvelope,
  makeUnauthorizedEnvelope,
} from "@/schemas/api";

describe("apiResponseSchema", () => {
  it("validates envelope", () => {
    const schema = apiResponseSchema(z.object({ x: z.number() }));
    expect(
      schema.parse({ code: 0, msg: "success", data: { x: 1 } }).data?.x,
    ).toBe(1);
  });
  it("rejects when inner data does not match", () => {
    const schema = apiResponseSchema(z.object({ x: z.number() }));
    expect(
      schema.safeParse({ code: 0, msg: "success", data: { x: "not-a-number" } })
        .success,
    ).toBe(false);
  });

  // Regression — dogfood QA Round 1 FIND-2 (qa.md §W3).
  // Backend's credential-failure envelope omits `data` entirely
  // (e.g. `{"code":101008,"msg":"invalid credentials"}`). The envelope
  // schema must accept a missing `data` key so the axios interceptor
  // can preserve the envelope; the `loginApi` then routes on `code`
  // and synthesises a `LoginCredentialsError` instead of swapping the
  // body for a synthetic network-error envelope.
  it("accepts a bare {code, msg} envelope with no data key", () => {
    const schema = apiResponseSchema(z.unknown());
    const result = schema.safeParse({
      code: 101008,
      msg: "invalid credentials",
    });
    expect(result.success).toBe(true);
  });
});

// `widen` erases the narrow inferred type so the `code === …` check
// isn't constant-folded away by `no-unnecessary-condition`.
// `assertType` is compile-time only — used instead of
// `expectTypeOf().toEqualTypeOf` (which trips on generic propagation).
const widen = <T>(env: ApiResponse<T>): ApiResponse<T> => env;
const assertType = <T>(value: T): void => {
  void value;
};
describe("ApiResponse<T> discriminated-union narrowing", () => {
  it("narrows data to T on the HTTP_OK branch", () => {
    const env = widen<{ x: number }>(makeOkEnvelope({ x: 1 }));
    if (env.code === HTTP_OK) {
      assertType<{ x: number }>(env.data);
      expect(env.data.x).toBe(1);
    } else {
      throw new Error("expected HTTP_OK envelope");
    }
  });

  it("narrows data to Record<string, never> on HTTP_UNAUTHORIZED", () => {
    const env = widen<{ x: number }>(makeUnauthorizedEnvelope());
    if (env.code === HTTP_UNAUTHORIZED) {
      assertType<Record<string, never>>(env.data);
      expect(env.data).toEqual({});
    } else {
      throw new Error("expected HTTP_UNAUTHORIZED envelope");
    }
  });

  it("narrows data to Record<string, never> on CLIENT_NETWORK_ERROR_CODE", () => {
    const env = widen<{ x: number }>({
      code: CLIENT_NETWORK_ERROR_CODE,
      msg: "unknown error",
      data: {},
    });
    if (env.code === CLIENT_NETWORK_ERROR_CODE) {
      assertType<Record<string, never>>(env.data);
    } else {
      throw new Error("expected CLIENT_NETWORK_ERROR_CODE envelope");
    }
  });

  // Pin exhaustiveness: a future `code: number` fallback would collapse
  // the union and `assertNever(env)` would fail to compile.
  it("discriminated union is exhaustive (assertNever compiles)", () => {
    const assertNever = (value: never): never => {
      throw new Error(`unreachable: ${String(value)}`);
    };
    const env = widen<{ x: number }>(makeOkEnvelope({ x: 1 }));
    switch (env.code) {
      case HTTP_OK:
        expect(env.data.x).toBe(1);
        break;
      case HTTP_UNAUTHORIZED:
        expect(env.data).toEqual({});
        break;
      case CLIENT_NETWORK_ERROR_CODE:
        expect(env.data).toEqual({});
        break;
      default:
        assertNever(env);
    }
  });

  it("factory return types pin the narrow branch (not the whole union)", () => {
    const ok = makeOkEnvelope({ x: 1 });
    expectTypeOf(ok.code).toEqualTypeOf<typeof HTTP_OK>();
    expectTypeOf(ok.data).toEqualTypeOf<{ x: number }>();

    const unauthorized = makeUnauthorizedEnvelope();
    expectTypeOf(unauthorized.code).toEqualTypeOf<typeof HTTP_UNAUTHORIZED>();
    expectTypeOf(unauthorized.data).toEqualTypeOf<Record<string, never>>();
  });
});
