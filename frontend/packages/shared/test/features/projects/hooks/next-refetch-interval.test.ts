/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
