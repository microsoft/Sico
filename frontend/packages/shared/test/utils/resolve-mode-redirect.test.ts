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

import {
  DEVELOPER_HOME,
  homeForMode,
  OPERATOR_HOME,
  resolveModeRedirect,
} from "@/utils/resolve-mode-redirect";

describe("homeForMode", () => {
  it("lands operator on the workspace", () => {
    expect(homeForMode("operator")).toBe(OPERATOR_HOME);
  });

  it("lands developer on the studio", () => {
    expect(homeForMode("developer")).toBe(DEVELOPER_HOME);
  });
});

// Matrix: {operator, developer} × {operator-only, developer-only, shared}.
describe("resolveModeRedirect", () => {
  it("allows a shared route (no declared modes) in operator mode", () => {
    expect(resolveModeRedirect("operator", [undefined, undefined])).toBeNull();
  });

  it("allows a shared route (no declared modes) in developer mode", () => {
    expect(resolveModeRedirect("developer", [undefined, undefined])).toBeNull();
  });

  it("allows operator on an operator-only route", () => {
    expect(resolveModeRedirect("operator", [["operator"]])).toBeNull();
  });

  it("allows developer on a developer-only route", () => {
    expect(resolveModeRedirect("developer", [["developer"]])).toBeNull();
  });

  it("redirects developer off an operator-only route to the studio", () => {
    expect(resolveModeRedirect("developer", [["operator"]])).toBe(
      DEVELOPER_HOME,
    );
  });

  it("redirects operator off a developer-only route to the workspace", () => {
    expect(resolveModeRedirect("operator", [["developer"]])).toBe(
      OPERATOR_HOME,
    );
  });

  it("uses the deepest declared restriction (leaf wins over ancestor)", () => {
    // ancestor allows both, leaf narrows to developer-only.
    expect(resolveModeRedirect("operator", [undefined, ["developer"]])).toBe(
      OPERATOR_HOME,
    );
  });

  it("ignores shallower undefined matches when a deeper one is declared", () => {
    expect(
      resolveModeRedirect("developer", [["developer"], undefined]),
    ).toBeNull();
  });
});
