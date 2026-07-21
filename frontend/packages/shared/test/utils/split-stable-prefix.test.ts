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
