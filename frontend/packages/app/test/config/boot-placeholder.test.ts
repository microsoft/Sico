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
