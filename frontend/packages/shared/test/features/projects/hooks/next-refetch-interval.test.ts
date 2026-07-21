import { describe, expect, it } from "vitest";

import { nextRefetchInterval } from "@/features/projects/hooks/next-refetch-interval";

describe("nextRefetchInterval", () => {
  it("polls 5000ms while any row is UPLOADED (status 2)", () => {
    expect(nextRefetchInterval([{ status: 2 }], 0)).toBe(5000);
  });

  it("stops (false) once every row is settled (INGESTED 3 / FAILED 1)", () => {
    expect(nextRefetchInterval([{ status: 3 }, { status: 1 }], 0)).toBe(false);
  });

  it("stops (false) once the 2-minute elapsed ceiling is hit while still UPLOADED", () => {
    expect(nextRefetchInterval([{ status: 2 }], 120_000)).toBe(false);
    // Just under the ceiling still polls.
    expect(nextRefetchInterval([{ status: 2 }], 119_000)).toBe(5000);
  });

  it("stops (false) when there are no rows", () => {
    expect(nextRefetchInterval([], 0)).toBe(false);
  });

  it("treats status-less (experience) rows as settled", () => {
    expect(nextRefetchInterval([{}], 0)).toBe(false);
  });
});
