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

import { resolveLandingPath } from "@/utils/resolve-landing-path";

// Inverse of `buildLoginRedirect`: decide post-login destination from
// `/login`'s search params. Sentinel `FALLBACK` pins the contract
// "returns the fallback verbatim on any rejected input".
const FALLBACK = "/__fallback";

describe("resolveLandingPath", () => {
  it("returns fallback when search is undefined", () => {
    expect(resolveLandingPath(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when search is null", () => {
    expect(resolveLandingPath(null, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when search is not an object", () => {
    expect(resolveLandingPath("not-an-object", FALLBACK)).toBe(FALLBACK);
    expect(resolveLandingPath(42, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when next is missing", () => {
    expect(resolveLandingPath({ code: 401 }, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when next is empty string", () => {
    expect(resolveLandingPath({ next: "" }, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when next is not a string", () => {
    expect(resolveLandingPath({ next: 123 }, FALLBACK)).toBe(FALLBACK);
    expect(resolveLandingPath({ next: ["/foo"] }, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when next does not start with /", () => {
    // Guards `next=//evil.com`, `next=javascript:...`.
    expect(resolveLandingPath({ next: "https://evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    // eslint-disable-next-line no-script-url -- exact bypass payload the function must reject
    expect(resolveLandingPath({ next: "javascript:alert(1)" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "no-leading-slash" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("returns fallback when next is protocol-relative (//host)", () => {
    expect(resolveLandingPath({ next: "//evil.com" }, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback when next uses backslash bypass (/\\host)", () => {
    // WHATWG URL parser normalises `\` → `/`, so `/\evil.com` is
    // functionally protocol-relative.
    expect(resolveLandingPath({ next: "/\\evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/\\\\evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("returns fallback when next has leading whitespace before //", () => {
    // Browsers strip leading whitespace, so `" //evil.com"` resolves
    // protocol-relative.
    expect(resolveLandingPath({ next: " //evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "\t//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "  //evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("returns fallback when next has leading control characters", () => {
    // NUL/CR/LF/DEL are stripped by browsers when parsing URLs.
    expect(resolveLandingPath({ next: "\u0000//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "\r\n//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "\u007F//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("rejects embedded (non-leading) control characters", () => {
    // WHATWG URL folds tab/LF/CR mid-string at navigation time.
    expect(resolveLandingPath({ next: "/\t/evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/\n//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/\r//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/\u0000//evil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/foo\t/evil.com" }, FALLBACK)).toBe(
      "/foo/evil.com",
    );
  });

  it("returns fallback when next encodes the slash (%2f)", () => {
    // `%2f%2fevil.com` decodes to `//evil.com`.
    expect(resolveLandingPath({ next: "%2f%2fevil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/%2fevil.com" }, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("returns fallback when next points back at /login", () => {
    // Self-redirect loop guard.
    expect(resolveLandingPath({ next: "/login" }, FALLBACK)).toBe(FALLBACK);
    expect(resolveLandingPath({ next: "/login?code=401" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/login#hash" }, FALLBACK)).toBe(
      FALLBACK,
    );
    expect(resolveLandingPath({ next: "/login/sub" }, FALLBACK)).toBe(FALLBACK);
  });

  it("accepts paths that begin with /login as a prefix (e.g. /logins)", () => {
    expect(resolveLandingPath({ next: "/logins" }, FALLBACK)).toBe("/logins");
    expect(resolveLandingPath({ next: "/logout" }, FALLBACK)).toBe("/logout");
  });

  it("returns the provided next when it is a same-origin path", () => {
    expect(resolveLandingPath({ next: "/foo" }, FALLBACK)).toBe("/foo");
    expect(resolveLandingPath({ next: "/digital-worker/123" }, FALLBACK)).toBe(
      "/digital-worker/123",
    );
  });
});
