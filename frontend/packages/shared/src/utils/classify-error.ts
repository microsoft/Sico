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
import { ZodError } from "zod";

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
 * - `server`  — 5xx response (backend failure with reachable network)
 * - `unknown` — anything else (4xx other than 401 which is handled by
 *               the axios interceptor; query cancellation; non-Error
 *               throws). Suspense remount / route-change cancels MUST
 *               NOT flash "Check your connection".
 */
export function classifyError(error: unknown): ErrorKind {
  if (error instanceof ZodError) {
    return "schema";
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
