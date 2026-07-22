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

// Render-time guard for `iconUri` values that flow into `<img src>`.
// Backend may send "", a relative path, or an absolute http(s) URL.
// Anything else (`data:`, `javascript:`, file://, blob:, etc.) is
// suppressed so a poisoned response can't smuggle tracking pixels or
// `data:` payloads through the avatar slot. Returns `undefined` to
// signal "fall back to initials / default icon".
//
// ALSO gates an `<a href>` (the asset-detail source-file chip) AND
// `window.open()` (the deliverable / open-link new-tab navigation). Keep the
// allowlist http(s)/same-origin only — do NOT permit `data:` here: it is
// inert in `<img src>` but XSS-capable in `<a href>` and `window.open`, so
// relaxing it for avatars would silently weaken those navigation consumers.
//
// Path-relative URLs are passed through (icons are served by our
// backend proxy under same-origin paths) but only if they have NO
// query string or fragment. Without that, a hostile payload like
// `/api/admin/whatever?confirm=1` would be GETed by the browser with
// cookies — turning the avatar slot into a same-origin SSRF surface
// against any GET endpoint that has side effects.
export function safeIconUri(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  // Relative path — same-origin, served by our app or backend proxy.
  // Reject `?` / `#` to deny side-effect GETs and fragment payloads.
  // Reject protocol-relative (`//host`) and backslash-smuggled
  // (`/\host`) forms — browsers resolve those against the page's
  // origin host, not the path, defeating same-origin intent.
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.startsWith("/\\")) {
      return undefined;
    }
    if (value.includes("?") || value.includes("#")) {
      return undefined;
    }
    return value;
  }
  // Absolute URL — only http/https, and no embedded userinfo
  // (`https://user:pass@host/x` leaks credentials in referrers).
  try {
    const url = new URL(value);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    ) {
      return value;
    }
  } catch {
    // Fall through.
  }
  return undefined;
}
