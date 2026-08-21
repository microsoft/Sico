import axios from "axios";
import { ZodError } from "zod";

import { EnvelopeError } from "../schemas/api";

export type ErrorKind = "network" | "server" | "schema" | "unknown";

/**
 * Single classifier shared by feature `<ErrorView>`s so error copy stays
 * consistent. Buckets:
 *
 * - `schema`  — zod parse failure (contract bug, not network)
 * - `network` — no response reached the app (DNS, refused, timeout,
 *               axios abort, or raw fetch/XHR `AbortError`/`TypeError`
 *               that bypassed axios — observed under Playwright
 *               `route.abort()` and some browser offline modes)
 * - `server`  — a reachable backend that FAILED: a 5xx response OR a non-OK
 *               `{code,msg}` envelope surfaced as an `EnvelopeError` (the
 *               backend returns errors as HTTP-200 envelopes, so this is the
 *               envelope-code analogue of a 5xx)
 * - `unknown` — anything else (4xx other than 401 which is handled by
 *               the axios interceptor; query cancellation; non-Error
 *               throws). Suspense remount / route-change cancels MUST
 *               NOT flash "Check your connection".
 */
export function classifyError(error: unknown): ErrorKind {
  if (error instanceof ZodError) {
    return "schema";
  }
  if (error instanceof EnvelopeError) {
    return "server";
  }
  if (axios.isCancel(error)) {
    return "unknown";
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    if (status === 0) {
      return "network";
    }
    if (status >= 500) {
      return "server";
    }
    return "unknown";
  }
  // Raw transport failure that bypassed axios (Playwright `route.abort()`,
  // browser offline mode). Match TypeError by message to avoid swallowing
  // genuine programming errors.
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "network";
    }
    if (
      error.name === "TypeError" &&
      /failed to fetch|load failed|network/i.test(error.message)
    ) {
      return "network";
    }
  }
  return "unknown";
}
