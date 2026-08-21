import { describe, expect, it } from "vitest";

import { firstMarkdownHeading } from "@/utils/markdown-title";

describe("firstMarkdownHeading", () => {
  it("returns the text of the first H1", () => {
    expect(firstMarkdownHeading("# Title\n\nbody")).toBe("Title");
  });

  it("skips leading blank lines and prose before the H1", () => {
    expect(firstMarkdownHeading("\nintro line\n# Real Title\n")).toBe(
      "Real Title",
    );
  });

  it("ignores deeper headings and returns the first H1", () => {
    expect(firstMarkdownHeading("## Sub\n# Top")).toBe("Top");
  });

  it("strips a closed-ATX trailing hash sequence", () => {
    expect(firstMarkdownHeading("# Title #")).toBe("Title");
  });

  it("returns undefined when there is no H1", () => {
    expect(firstMarkdownHeading("## Only sub\n\nbody")).toBeUndefined();
  });

  it("returns undefined for empty markdown", () => {
    expect(firstMarkdownHeading("")).toBeUndefined();
  });
});
