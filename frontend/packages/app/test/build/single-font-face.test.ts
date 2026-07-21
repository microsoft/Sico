import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { distDir, listDistFiles } from "./dist-helpers";

// Require `font-family` inside the block to avoid matching empty/partial
// blocks; `/gi` makes the match case-insensitive.
const FONT_FACE = /@font-face\s*\{[^{}]*font-family[^{}]*\}/gi;

describe("build artifact: single @font-face", () => {
  it("emitted CSS contains exactly one @font-face block (Geist)", () => {
    const all = listDistFiles();
    const cssFiles = all
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFileSync(path.join(distDir, f), "utf8"));
    const blocks = cssFiles.flatMap((c) => c.match(FONT_FACE) ?? []);
    expect(blocks).toEqual([expect.stringMatching(/Geist/)]);
  });
});
