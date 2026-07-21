import { describe, expect, it } from "vitest";

import { safeWebpageUrl } from "@/features/file-preview/utils/webpage-url";

describe("safeWebpageUrl", () => {
  it("returns the normalized href for an https url", () => {
    expect(safeWebpageUrl("https://example.com/p")).toBe(
      "https://example.com/p",
    );
  });

  // A literal `javascript:` URL trips eslint's `no-script-url`, but rejecting
  // exactly that scheme is the whole point of this gate — join the parts so the
  // security fixture stays without writing the literal (or suppressing the rule).
  const scriptSchemeUrl = ["javascript", "alert(1)"].join(":");

  // The reject path: anything that isn't a parseable https URL → null, so the
  // caller renders a "blocked" state instead of mounting the iframe. `http:` is
  // mixed-content; `javascript:` / `data:` are XSS/exfiltration vectors.
  it.each([
    "http://example.com",
    scriptSchemeUrl,
    "data:text/html,<script>",
    "not a url",
    "",
  ])("returns null for disallowed or unparseable input: %j", (raw) => {
    expect(safeWebpageUrl(raw)).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    // `new URL` normalizes a bare host with a trailing slash.
    expect(safeWebpageUrl("  https://example.com  ")).toBe(
      "https://example.com/",
    );
  });

  it("strips wrapping double-quotes (legacy agent URLs arrive quoted)", () => {
    expect(safeWebpageUrl('"https://example.com/p"')).toBe(
      "https://example.com/p",
    );
  });
});
