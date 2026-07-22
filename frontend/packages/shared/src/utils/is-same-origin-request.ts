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

// Same-origin gate so absolute URLs to third-party hosts cannot receive our
// bearer token. Resolves `requestUrl` against `baseUrl` first so
// `api.get("/me")` against `baseURL: "https://api.example.com"` is evaluated
// absolute. Relative request URLs (no host) resolve to the document origin, so
// they pass. Malformed inputs and non-browser (SSR) contexts default to
// `false` — a conservative "no header" stance.
//
// Consumed by both the axios request interceptor and the raw `fetchEventSource`
// SSE streams (chat + reconnect), which bypass axios but carry the same token.
export function isSameOriginRequest(
  requestUrl: string | undefined,
  baseUrl: string | undefined,
): boolean {
  if (!requestUrl) {
    return false;
  }
  const hasOrigin = typeof window !== "undefined" && Boolean(window.location);
  const documentOrigin = hasOrigin ? window.location.origin : null;

  try {
    const originFallback = documentOrigin ?? "http://localhost";
    const absoluteBase = baseUrl
      ? new URL(baseUrl, originFallback).toString()
      : originFallback;
    const resolved = new URL(requestUrl, absoluteBase);
    if (documentOrigin === null) {
      // SSR / Node-only context — conservative "no header" stance.
      return false;
    }
    return resolved.origin === documentOrigin;
  } catch {
    return false;
  }
}
