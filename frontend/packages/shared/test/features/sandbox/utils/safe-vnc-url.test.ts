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

import { afterEach, describe, expect, it, vi } from "vitest";

import { safeVncUrl } from "@/features/sandbox/utils/safe-vnc-url";

// jsdom serves the test realm from http://localhost:3000, so a relative path
// resolves to that origin and counts as same-origin.
const ORIGIN = "http://localhost:3000";

describe("safeVncUrl", () => {
  it("allows a same-origin relative path (the real backend shape)", () => {
    const raw =
      "/api/dwp/sandbox/resources/wincua/abc/vnc/novnc/vnc.html?path=x%2Fy&resize=scale";
    expect(safeVncUrl(raw)).toBe(`${ORIGIN}${raw}`);
  });

  it("allows an absolute https url", () => {
    expect(safeVncUrl("https://test.sico.microsoft.com/api/dwp/x")).toBe(
      "https://test.sico.microsoft.com/api/dwp/x",
    );
  });

  it("strips wrapping double-quotes before resolving", () => {
    expect(safeVncUrl('"/api/dwp/vnc.html"')).toBe(
      `${ORIGIN}/api/dwp/vnc.html`,
    );
  });

  it("blocks an absolute http url (cross-origin, mixed-content)", () => {
    expect(safeVncUrl("http://evil.example/x")).toBeNull();
  });

  it("blocks a protocol-relative url pointing off-origin", () => {
    expect(safeVncUrl("//evil.example/x")).toBeNull();
  });

  // A literal `javascript:` URL trips eslint's no-script-url; join the parts so
  // the security fixture stays without writing the literal.
  it("blocks a javascript: scheme", () => {
    const scriptUrl = ["javascript", "alert(1)"].join(":");
    expect(safeVncUrl(scriptUrl)).toBeNull();
  });

  it("blocks a data: scheme", () => {
    expect(safeVncUrl("data:text/html,<script>")).toBeNull();
  });

  it("returns null for the empty string", () => {
    expect(safeVncUrl("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(safeVncUrl("   ")).toBeNull();
  });

  // Quotes wrapping only whitespace must collapse to "" (quote-strip happens
  // before trim), not resolve to the app root.
  it("returns null for quotes wrapping whitespace", () => {
    expect(safeVncUrl('"   "')).toBeNull();
  });
});

// The same-origin allow-branch makes the gate origin-sensitive, so the
// security-critical rejections MUST be proven against a production https origin,
// not just jsdom's http one — under https, `new URL("//host", origin)` promotes
// the scheme to https, which an earlier version wrongly waved through.
describe("safeVncUrl under an https page origin", () => {
  const HTTPS_ORIGIN = "https://app.sico.example";
  afterEach(() => vi.unstubAllGlobals());

  it("still blocks protocol-relative //host (no https promotion)", () => {
    vi.stubGlobal("location", { origin: HTTPS_ORIGIN });
    expect(safeVncUrl("//evil.example/x")).toBeNull();
  });

  it("still blocks an absolute http url", () => {
    vi.stubGlobal("location", { origin: HTTPS_ORIGIN });
    expect(safeVncUrl("http://evil.example/x")).toBeNull();
  });

  it("allows a same-origin relative path", () => {
    vi.stubGlobal("location", { origin: HTTPS_ORIGIN });
    expect(safeVncUrl("/api/dwp/vnc.html")).toBe(
      `${HTTPS_ORIGIN}/api/dwp/vnc.html`,
    );
  });

  it("allows an absolute https url to a different host", () => {
    vi.stubGlobal("location", { origin: HTTPS_ORIGIN });
    expect(safeVncUrl("https://test.sico.microsoft.com/x")).toBe(
      "https://test.sico.microsoft.com/x",
    );
  });
});
