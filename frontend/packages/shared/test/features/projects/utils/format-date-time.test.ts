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

import { formatDateTime } from "@/features/projects/utils/format-date-time";

// Inputs are built from local-time strings (no `Z`) so the asserted output is
// independent of the test runner's timezone — `formatDateTime` renders in the
// viewer's local zone (no hardcoded UTC).
describe("formatDateTime", () => {
  it("formats a local-time value as 'YYYY-MM-DD HH:mm'", () => {
    const at = new Date("2023-11-14T22:13:00").getTime();
    expect(formatDateTime(at)).toBe("2023-11-14 22:13");
  });

  it("zero-pads month, day, hour, and minute", () => {
    const at = new Date("2023-01-02T03:04:00").getTime();
    expect(formatDateTime(at)).toBe("2023-01-02 03:04");
  });

  it("uses a 24-hour clock (no AM/PM)", () => {
    const at = new Date("2023-11-14T13:00:00").getTime();
    expect(formatDateTime(at)).toBe("2023-11-14 13:00");
  });

  it("renders midnight as 00:00, not 24:00 (h23 hour cycle)", () => {
    const at = new Date("1970-01-01T00:00:00").getTime();
    expect(formatDateTime(at)).toBe("1970-01-01 00:00");
  });
});
