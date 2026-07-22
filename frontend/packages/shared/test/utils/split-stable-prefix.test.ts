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

import { splitStablePrefix } from "@/utils/split-stable-prefix";

describe("splitStablePrefix", () => {
  it("returns the index after the last fence-safe blank line", () => {
    const content = "# A\n\nB\n\nC";
    const at = splitStablePrefix(content);
    // Everything up to and including the last blank line is settled; the final
    // block ("C") is still live.
    expect(content.slice(0, at)).toBe("# A\n\nB\n\n");
    expect(content.slice(at)).toBe("C");
  });

  it("does NOT split inside an open ``` fence", () => {
    const content = "intro\n\n```\ncode\n\nstill code";
    const at = splitStablePrefix(content);
    // The blank line inside the unclosed fence is NOT safe; the only safe
    // boundary is the blank line before the fence opened.
    expect(content.slice(0, at)).toBe("intro\n\n");
  });

  it("does NOT split inside an open ~~~ fence (legacy bug — fixed)", () => {
    const content = "intro\n\n~~~\ncode\n\nstill code";
    const at = splitStablePrefix(content);
    expect(content.slice(0, at)).toBe("intro\n\n");
  });

  it("returns 0 when no safe boundary exists yet (render all live)", () => {
    expect(splitStablePrefix("a single growing line")).toBe(0);
    // The only blank line lives inside an unclosed fence → nothing is settled.
    expect(splitStablePrefix("```\ncode\n\nmore")).toBe(0);
  });

  it("is monotonic: appending to the tail never moves the boundary backward", () => {
    let content = "# Title\n\nfirst paragraph";
    let prev = splitStablePrefix(content);
    const appends = [
      " continues",
      "\n\nsecond",
      " para",
      "\n\n```\ncode",
      "\n```",
      "\n\nthird",
    ];
    for (const chunk of appends) {
      content += chunk;
      const next = splitStablePrefix(content);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});
