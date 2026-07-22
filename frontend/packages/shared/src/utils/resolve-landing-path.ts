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

// Strip ALL control chars + space globally (not anchored). The WHATWG
// URL parser folds tab / LF / CR / NUL anywhere in a URL before
// navigation, so `"/\t/evil.com"` would otherwise parse as
// `"//evil.com"` (protocol-relative open redirect).
// eslint-disable-next-line no-control-regex -- defensive open-redirect guard
const CONTROL_OR_WS = /[\u0000-\u0020\u007F]/g;

// One forward slash + a non-slash / non-backslash / non-percent char.
// `%` exclusion blocks `/%2fevil.com` percent-encoded bypasses.
const SAME_ORIGIN_PATH = /^\/[^/\\%]/;

export function resolveLandingPath(search: unknown, fallback: string): string {
  if (search === null || typeof search !== "object") {
    return fallback;
  }
  const next = (search as { next?: unknown }).next;
  if (typeof next !== "string" || next.length === 0) {
    return fallback;
  }
  const normalised = next.replace(CONTROL_OR_WS, "");
  if (normalised.length === 0) {
    return fallback;
  }
  if (!SAME_ORIGIN_PATH.test(normalised)) {
    return fallback;
  }
  // Block `/login`, `/login?…`, `/login#…`, `/login/anything` to avoid a
  // self-redirect loop. `/logins` stays safe because the next char must
  // be `/`, `?`, `#`, or end-of-string.
  if (
    normalised === "/login" ||
    normalised.startsWith("/login/") ||
    normalised.startsWith("/login?") ||
    normalised.startsWith("/login#")
  ) {
    return fallback;
  }
  return normalised;
}
