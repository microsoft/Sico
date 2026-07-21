import { z } from "zod";

import {
  CLIENT_NETWORK_ERROR_CODE,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "../constants/http";

// `data` is optional: the backend omits the key on non-zero `code`
// envelopes (e.g. credential failure returns `{code:101008,msg:"..."}`
// with no `data`). Callers must branch on `code` first.
// See dogfood QA Round 1 FIND-2.
export const apiResponseSchema = <T extends z.ZodTypeAny>(
  data: T,
): z.ZodObject<{
  code: z.ZodNumber;
  msg: z.ZodString;
  data: z.ZodOptional<T>;
}> =>
  z.object({
    code: z.number(),
    msg: z.string(),
    data: data.optional(),
  });

// Throw on a non-OK envelope `code` so the caller sees the real failure code,
// not a downstream "missing data". For edit/delete fns that carry no `data`.
export function assertOk(parsed: { code: number }, context: string): void {
  if (parsed.code !== HTTP_OK) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["code"],
        message: `${context}: rejected (code ${parsed.code})`,
      },
    ]);
  }
}

// Unwrap a parsed apiResponse envelope. Rejects a non-OK `code` FIRST (via
// `assertOk`) so the caller sees the real failure, then requires `data`.
export function unwrapData<T>(
  parsed: { code: number; data?: T | null },
  context: string,
): T {
  assertOk(parsed, context);
  if (parsed.data === undefined || parsed.data === null) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["data"],
        message: `${context}: missing data in envelope`,
      },
    ]);
  }
  return parsed.data;
}

// Discriminated union narrows on actual emitted codes — adding a
// `number & {}` branch would collapse the discriminant.
export type ApiResponseOk<T> = {
  code: typeof HTTP_OK;
  msg: string;
  data: T;
};

export type ApiResponseUnauthorized = {
  code: typeof HTTP_UNAUTHORIZED;
  msg: string;
  data: Record<string, never>;
};

export type ApiResponseNetworkError = {
  code: typeof CLIENT_NETWORK_ERROR_CODE;
  msg: string;
  data: Record<string, never>;
};

export type ApiResponse<T> =
  | ApiResponseOk<T>
  | ApiResponseUnauthorized
  | ApiResponseNetworkError;

export function makeOkEnvelope<T>(data: T): ApiResponseOk<T> {
  return { code: HTTP_OK, msg: "ok", data };
}

export function makeUnauthorizedEnvelope(): ApiResponseUnauthorized {
  return { code: HTTP_UNAUTHORIZED, msg: "unauthorized", data: {} };
}
