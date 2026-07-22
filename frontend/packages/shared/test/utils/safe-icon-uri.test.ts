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

import { describe, expect, it } from "vitest";

import { safeIconUri } from "@/utils/safe-icon-uri";

describe("safeIconUri", () => {
  it("returns undefined for undefined / empty", () => {
    expect(safeIconUri(undefined)).toBeUndefined();
    expect(safeIconUri("")).toBeUndefined();
  });

  it("passes relative paths through", () => {
    expect(safeIconUri("/avatars/1.png")).toBe("/avatars/1.png");
  });

  it("passes http(s) absolute URLs through", () => {
    expect(safeIconUri("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(safeIconUri("http://cdn.example.com/a.png")).toBe(
      "http://cdn.example.com/a.png",
    );
  });

  it("rejects dangerous schemes", () => {
    // eslint-disable-next-line no-script-url -- under test
    expect(safeIconUri("javascript:alert(1)")).toBeUndefined();
    expect(safeIconUri("data:image/png;base64,AAAA")).toBeUndefined();
    expect(safeIconUri("file:///etc/passwd")).toBeUndefined();
    expect(safeIconUri("blob:https://example.com/abc")).toBeUndefined();
  });

  it("rejects malformed strings", () => {
    expect(safeIconUri("not a url")).toBeUndefined();
  });

  // Same-origin SSRF guard: `<img src="/api/logout?confirm=1">` would be
  // GETed by the browser with cookies. Reject query/fragment on relative
  // paths so a hostile payload cannot turn the avatar slot into a
  // side-effect trigger against any GET endpoint.
  it("rejects relative paths with query string", () => {
    expect(safeIconUri("/api/logout?confirm=1")).toBeUndefined();
  });

  it("rejects relative paths with fragment", () => {
    expect(safeIconUri("/avatars/1.png#frag")).toBeUndefined();
  });

  // Protocol-relative URLs (`//host/path`) start with `/` but are
  // resolved by the browser against the page's *origin*, not the path
  // — turning the avatar slot into an off-origin GET. Reject before
  // the same-origin relative-path branch can pass them through.
  it("rejects protocol-relative URLs", () => {
    expect(safeIconUri("//evil.com/x.png")).toBeUndefined();
  });

  it("rejects backslash-smuggled protocol-relative URLs", () => {
    expect(safeIconUri("/\\evil.com/x.png")).toBeUndefined();
  });

  // Absolute URLs with userinfo (`https://user:pass@host/x`) leak
  // credentials in referrer headers and confuse origin parsing in
  // some logging pipelines. Reject.
  it("rejects absolute URLs with userinfo", () => {
    expect(safeIconUri("https://u:p@cdn.example.com/a.png")).toBeUndefined();
    expect(safeIconUri("https://user@cdn.example.com/a.png")).toBeUndefined();
  });
});
