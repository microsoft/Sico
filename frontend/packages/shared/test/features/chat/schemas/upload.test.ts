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

import { uploadEnvelopeSchema } from "@/features/chat/schemas/upload";

describe("uploadEnvelopeSchema", () => {
  it("parses a successful upload envelope", () => {
    const result = uploadEnvelopeSchema.safeParse({
      code: 0,
      msg: "ok",
      data: {
        id: 5,
        metaInfo: {
          contentType: "application/pdf",
          fileExt: "pdf",
          fileName: "a.pdf",
          fileSize: 10,
          fileType: "pdf",
        },
        sasUrl: "https://blob/sas",
        uri: "asset://a",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when inner data omits uri", () => {
    const result = uploadEnvelopeSchema.safeParse({
      code: 0,
      msg: "ok",
      data: { id: 5, metaInfo: {}, sasUrl: "s" },
    });
    expect(result.success).toBe(false);
  });
});
