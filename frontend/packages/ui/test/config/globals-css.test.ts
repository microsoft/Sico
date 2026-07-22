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

const css = readFileSync(
  path.resolve(__dirname, "../../src/styles/globals.css"),
  "utf8",
);

describe("globals.css", () => {
  it("declares exactly one @font-face block (Geist)", () => {
    const matches = css.match(/@font-face\s*{[^}]+}/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatch(/Geist/);
    expect(matches[0]).toMatch(/font-display:\s*swap/);
  });
  it("declares a Tailwind v4 @theme with --font-sans", () => {
    // Two-step assertion: the @theme block is hundreds of lines so a
    // single regex overshoots the closing `}`. Confirm the opener
    // exists AND `--font-sans` resolves to Geist + system-ui.
    expect(css).toMatch(/@theme\s*{/);
    expect(css).toMatch(/--font-sans:[^;]*Geist[^;]*system-ui[^;]*;/);
  });
  it("has a :focus-visible baseline ring", () => {
    // Lock the ring itself — an empty `:focus-visible {}` must not pass.
    expect(css).toMatch(/:focus-visible[^{]*{[^}]*outline:[^;]+;/);
  });
  it("does not reference Switzer / NotoSansSC / Outfit / Satoshi", () => {
    expect(css).not.toMatch(/Switzer|NotoSansSC|Outfit|Satoshi/);
  });
});
