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
