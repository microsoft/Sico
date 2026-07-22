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

import {
  createQueryClient,
  QUERY_RETRY_BASE_MS,
  QUERY_RETRY_COUNT,
  QUERY_RETRY_MAX_MS,
} from "@/services/query-client";

describe("queryClient", () => {
  it("uses QUERY_RETRY_COUNT for retry", () => {
    const qc = createQueryClient();
    expect(qc.getDefaultOptions().queries?.retry).toBe(QUERY_RETRY_COUNT);
  });

  it("has exponential backoff retryDelay capped at QUERY_RETRY_MAX_MS", () => {
    const qc = createQueryClient();
    const retryDelay = qc.getDefaultOptions().queries?.retryDelay;
    expect(typeof retryDelay).toBe("function");
    if (typeof retryDelay === "function") {
      // Assertions reference the exported constants so the test stays
      // in lock-step if the policy is ever retuned. Behaviour:
      // i=0 → BASE, i=1 → 2*BASE, i=2 → 4*BASE, … eventually capped at MAX.
      expect(retryDelay(0, new Error("test"))).toBe(QUERY_RETRY_BASE_MS);
      expect(retryDelay(1, new Error("test"))).toBe(QUERY_RETRY_BASE_MS * 2);
      expect(retryDelay(10, new Error("test"))).toBe(QUERY_RETRY_MAX_MS);
    }
  });
});
