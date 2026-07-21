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
