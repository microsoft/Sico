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

import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { uploadSkillAsset } from "@/features/skill/services/asset-upload";
import { makeOkEnvelope } from "@/schemas/api";

describe("uploadSkillAsset", () => {
  it("posts the file as multipart and returns the asset id", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: makeOkEnvelope({ id: 42 }) });
    const apiClient = { post } as Partial<AxiosInstance> as AxiosInstance;
    const file = new File(["x"], "skill.md", { type: "text/markdown" });

    const id = await uploadSkillAsset(apiClient, file);

    expect(id).toBe(42);
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe("/project/asset");
    expect(body).toBeInstanceOf(FormData);
  });

  it("throws on a non-OK envelope", async () => {
    const post = vi.fn().mockResolvedValue({ data: { code: 7, msg: "fail" } });
    const apiClient = { post } as Partial<AxiosInstance> as AxiosInstance;
    await expect(
      uploadSkillAsset(apiClient, new File(["x"], "a.md")),
    ).rejects.toThrow();
  });
});
