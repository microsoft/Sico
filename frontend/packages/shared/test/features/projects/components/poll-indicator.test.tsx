import { describe, expect, it } from "vitest";

import {
  FAILED_TEXT,
  FAILED_TIP,
  shimmerNameClassName,
} from "@/features/projects/components/poll-indicator";

// The per-row extraction visuals (shimmer name, red-triangle icon tile, failed
// label in the TYPE column) live in `asset-row` and are asserted there; this
// module is now just the shared constants those surfaces consume.
describe("poll-indicator constants", () => {
  it("exposes an animated shiny-text class for the extracting name", () => {
    expect(shimmerNameClassName).toContain("shiny-text");
    expect(shimmerNameClassName).toContain("animate-shimmer");
  });

  it("carries the §5 failed copy", () => {
    expect(FAILED_TEXT).toBe("Extraction failed");
    expect(FAILED_TIP).toBe(
      "Make sure the file's permission is open to public, then re-upload.",
    );
  });
});
