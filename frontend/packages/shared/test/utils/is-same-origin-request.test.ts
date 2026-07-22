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

import { isSameOriginRequest } from "@/utils/is-same-origin-request";

// jsdom defaults `window.location.origin` to `http://localhost:3000`.

describe("isSameOriginRequest", () => {
  it("returns false for an undefined request URL", () => {
    expect(isSameOriginRequest(undefined, undefined)).toBe(false);
  });

  it("treats a relative path as same-origin", () => {
    expect(isSameOriginRequest("/api/sico/x", undefined)).toBe(true);
  });

  it("treats an absolute same-origin URL as same-origin", () => {
    expect(
      isSameOriginRequest(`${window.location.origin}/api/sico/x`, undefined),
    ).toBe(true);
  });

  it("treats an absolute cross-origin URL as cross-origin", () => {
    expect(
      isSameOriginRequest("https://evil.example.com/leak", undefined),
    ).toBe(false);
  });

  it("treats a protocol-relative cross-origin URL as cross-origin", () => {
    expect(isSameOriginRequest("//evil.example.com/leak", undefined)).toBe(
      false,
    );
  });

  it("resolves a relative request URL against an absolute cross-origin baseURL", () => {
    expect(isSameOriginRequest("/me", "https://api.example.com")).toBe(false);
  });

  it("returns false for a malformed request URL", () => {
    expect(isSameOriginRequest("http://[", undefined)).toBe(false);
  });
});
