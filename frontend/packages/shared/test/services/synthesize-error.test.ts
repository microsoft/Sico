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

import { CLIENT_NETWORK_ERROR_CODE } from "@/constants/http";
import { synthesizeNetworkError } from "@/services/synthesize-error";

describe("synthesizeNetworkError", () => {
  it("returns a CLIENT_NETWORK_ERROR_CODE envelope with the default message", () => {
    const error = synthesizeNetworkError();
    expect(error.code).toBe(CLIENT_NETWORK_ERROR_CODE);
    expect(error.msg).toBe("unknown error");
    expect(error.data).toEqual({});
  });

  it("accepts an optional `msg` override", () => {
    const error = synthesizeNetworkError("ENOTFOUND api.example.test");
    expect(error.code).toBe(CLIENT_NETWORK_ERROR_CODE);
    expect(error.msg).toBe("ENOTFOUND api.example.test");
    expect(error.data).toEqual({});
  });

  it("falls back to the default when override is an empty string", () => {
    // Empty-string would render as a blank toast — fall back to default.
    const error = synthesizeNetworkError("");
    expect(error.msg).toBe("unknown error");
  });
});
