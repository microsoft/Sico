import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatDateTime } from "@/features/chat/utils/format-date-time";

// "now" is pinned to a local-time noon so day-tier comparisons never straddle a
// midnight boundary, and inputs are built from local-time strings (no `Z`) — the
// asserted HH:mm is then independent of the test runner's timezone.
const NOW = new Date("2024-06-15T12:00:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatDateTime", () => {
  it("formats a same-day timestamp as HH:mm (no date, no prefix)", () => {
    const today = new Date("2024-06-15T09:30:00").getTime();
    expect(formatDateTime(today)).toBe("09:30");
  });

  it("prefixes a yesterday timestamp with 'Yesterday '", () => {
    const yesterday = new Date("2024-06-14T23:15:00").getTime();
    expect(formatDateTime(yesterday)).toBe("Yesterday 23:15");
  });

  it("formats an earlier-this-year timestamp as MM-DD HH:mm (no year)", () => {
    // Legacy `Cards/utils.ts` 4th tier: same calendar year but older than
    // yesterday drops the year → `MM-DD HH:mm`. NOW is 2024-06-15.
    const thisYear = new Date("2024-01-02T08:05:00").getTime();
    expect(formatDateTime(thisYear)).toBe("01-02 08:05");
  });

  it("formats a prior-year timestamp as YYYY-MM-DD HH:mm", () => {
    const lastYear = new Date("2023-12-31T08:05:00").getTime();
    expect(formatDateTime(lastYear)).toBe("2023-12-31 08:05");
  });

  it("zero-pads the hour at and after midnight (h23, never 24:00)", () => {
    const midnight = new Date("2024-06-15T00:07:00").getTime();
    expect(formatDateTime(midnight)).toBe("00:07");
  });
});
