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

import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  openSidepane,
  type SidepaneContent,
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "@/features/chat/atoms/sidepane-atom";

describe("sidepane-atom defaults", () => {
  it("starts closed and un-maximized (content null)", () => {
    const store = createStore();
    expect(store.get(sidepaneContentAtom)).toBeNull();
    expect(store.get(sidepaneMaximizedAtom)).toBe(false);
  });
});

describe("openSidepane", () => {
  it("writes the content payload", () => {
    const store = createStore();
    openSidepane(store, { kind: "sandbox", agentInstanceId: 7 });
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "sandbox",
      agentInstanceId: 7,
    });
  });

  // MP13: a fresh item must not inherit a prior previewer's maximize state —
  // the shared open path always resets it, which is why both call sites use it.
  it("resets a previously-maximized pane to un-maximized", () => {
    const store = createStore();
    store.set(sidepaneMaximizedAtom, true);
    openSidepane(store, { kind: "webpage", url: "https://example.com" });
    expect(store.get(sidepaneMaximizedAtom)).toBe(false);
  });
});

// Acceptance criterion: SidepaneContent lives in a jotai atom and must stay
// serializable — NO JSX, NO functions. A JSON round-trip is the guard: a
// dropped field (a smuggled-in element or callback) would make the result
// differ from the original, failing `toEqual`.
describe("SidepaneContent serializability", () => {
  const variants: NonNullable<SidepaneContent>[] = [
    { kind: "markdown", title: "Summary", markdown: "# heading" },
    { kind: "webpage", url: "https://example.com" },
    { kind: "sandbox", agentInstanceId: 413 },
    { kind: "file", filename: "report.pdf", fileUrl: "https://x/report.pdf" },
  ];

  it.each(variants)("round-trips the $kind variant unchanged", (content) => {
    expect(JSON.parse(JSON.stringify(content))).toEqual(content);
  });
});
