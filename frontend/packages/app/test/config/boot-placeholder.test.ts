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

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

describe("index.html boot placeholder", () => {
  it("contains .shell-boot inside #root", () => {
    expect(html).toMatch(/<div id="root">\s*<div[^>]*class="shell-boot"/);
  });
  it("contains Loading… text", () => {
    expect(html).toMatch(/Loading/);
  });
  it("does not imitate sidebar (no aside)", () => {
    expect(html).not.toMatch(/<aside/);
  });
  it("does not imitate login form (no form/input)", () => {
    expect(html).not.toMatch(/<(form|input)/);
  });
  it("declares fade-in animation duration via inline css", () => {
    // Any millisecond duration is fine — designers can tune the fade-in
    // without breaking this test. The guarantee is "there IS a fade-in",
    // not "the fade-in is exactly 200ms".
    expect(html).toMatch(/animation:[^;]*\d+ms/);
  });
});
