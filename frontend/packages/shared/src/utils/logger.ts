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

/// <reference types="vite/client" />
/* eslint-disable no-console -- canonical logger sink for the monorepo */

// Dev / test: full payload passes through. Production: each non-string
// arg is scrubbed (axios-like → `{name, message, url, status}`; Error →
// `{name, message}`; other objects → `"[object]"`; primitives → through).

// Guarded so Playwright's Node-side spec collection (no `import.meta.env`)
// doesn't crash; literal `MODE` access preserves Vite's build-time inlining.
const isProd =
  typeof import.meta.env !== "undefined" &&
  import.meta.env.MODE === "production";

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

function isAxiosErrorLike(value: unknown): value is {
  name?: string;
  message?: string;
  config?: { url?: string };
  response?: { status?: number };
} {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (
    "isAxiosError" in value ||
    ("config" in value && "response" in value) ||
    ("config" in value && "request" in value)
  );
}

function scrub(arg: unknown): unknown {
  if (arg === null || arg === undefined) {
    return arg;
  }
  if (typeof arg !== "object") {
    return arg;
  }
  // Axios check first — AxiosError extends Error.
  if (isAxiosErrorLike(arg)) {
    return {
      name: arg.name,
      message: arg.message,
      url: arg.config?.url,
      status: arg.response?.status,
    };
  }
  if (isErrorLike(arg)) {
    return { name: arg.name, message: arg.message };
  }
  return "[object]";
}

function scrubArgs(args: unknown[]): unknown[] {
  if (!isProd) {
    return args;
  }
  return args.map(scrub);
}

export const logger = {
  debug: isProd
    ? (): void => {}
    : (...a: unknown[]): void => console.debug(...a),
  info: (...a: unknown[]): void => console.info(...scrubArgs(a)),
  warn: (...a: unknown[]): void => console.warn(...scrubArgs(a)),
  error: (...a: unknown[]): void => console.error(...scrubArgs(a)),
};
