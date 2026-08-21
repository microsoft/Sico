import { describe, expect, it } from "vitest";

import { formatLastActive } from "@/features/projects/utils/format-last-active";

// LAST ACTIVE reaches the formatter from two sources with different units:
// `project.updatedAt`/agent `updatedAt` (epoch MS) and per-member
// `rbacUser.updatedAt` (epoch SECONDS). It normalizes by magnitude, then
// renders via `formatDateTime` for a locale-stable `YYYY-MM-DD HH:mm` string
// (no browser-locale drift → no CJK "年月日"). Inputs use local-time strings
// (no `Z`) so the asserted output is timezone-independent.
describe("formatLastActive", () => {
  it("renders a 13-digit epoch-ms value as YYYY-MM-DD HH:mm", () => {
    const ms = new Date("2026-07-10T22:31:00").getTime();
    expect(formatLastActive(ms)).toBe("2026-07-10 22:31");
  });

  it("renders a 10-digit epoch-seconds value as YYYY-MM-DD HH:mm", () => {
    const seconds = Math.floor(
      new Date("2026-07-10T22:31:00").getTime() / 1000,
    );
    expect(formatLastActive(seconds)).toBe("2026-07-10 22:31");
  });

  it("does not multiply an epoch-ms value into a far-future year", () => {
    const ms = new Date("2026-07-10T22:31:00").getTime();
    expect(formatLastActive(ms)).not.toContain("58506");
  });
});
