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

import { DW_DEFAULT_AVATAR_URL, PROJECT_DEFAULT_AVATAR_URL } from "../src";

describe("DW_DEFAULT_AVATAR_URL", () => {
  it("resolves to a non-empty URL string", () => {
    expect(typeof DW_DEFAULT_AVATAR_URL).toBe("string");
    expect(DW_DEFAULT_AVATAR_URL.length).toBeGreaterThan(0);
  });
});

describe("PROJECT_DEFAULT_AVATAR_URL", () => {
  it("resolves to a non-empty URL string", () => {
    expect(typeof PROJECT_DEFAULT_AVATAR_URL).toBe("string");
    expect(PROJECT_DEFAULT_AVATAR_URL.length).toBeGreaterThan(0);
  });
});
