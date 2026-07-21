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
