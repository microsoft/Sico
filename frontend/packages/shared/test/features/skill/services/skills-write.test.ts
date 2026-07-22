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

import {
  createSkill,
  deleteSkill,
  updateSkill,
} from "@/features/skill/services/skills";
import { makeOkEnvelope } from "@/schemas/api";

function client(
  fns: Partial<Record<"post" | "put" | "delete", unknown>>,
): AxiosInstance {
  return fns as Partial<AxiosInstance> as AxiosInstance;
}

describe("skills write services", () => {
  it("createSkill posts agentId+assetId and returns the created skill", async () => {
    const post = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        skill: {
          id: 9,
          agentId: "a",
          name: "S",
          description: "",
          version: "v1",
          status: 1,
          assetId: 5,
          creatorUsername: "",
          failReason: "",
          projectId: 1,
          createdAt: 1,
          updatedAt: "2",
        },
      }),
    });
    const res = await createSkill(client({ post }), {
      agentId: "a",
      assetId: 5,
    });
    expect(res.id).toBe(9);
    expect(post).toHaveBeenCalledWith("/skills", {
      agentId: "a",
      assetId: 5,
      projectId: undefined,
    });
  });

  it("updateSkill puts a new version and returns version metadata", async () => {
    const put = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        skillId: 9,
        version: "v2",
        versionId: 101,
        name: "S",
        description: "d",
      }),
    });
    const res = await updateSkill(client({ put }), {
      id: 9,
      currentVersion: "v1",
      files: [{ path: "skill.md", content: "x" }],
    });
    expect(res.version).toBe("v2");
    expect(res.versionId).toBe(101);
  });

  it("deleteSkill resolves on an OK envelope", async () => {
    const del = vi.fn().mockResolvedValue({ data: { code: 0, msg: "ok" } });
    await expect(
      deleteSkill(client({ delete: del }), 9),
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith("/skills", { params: { id: 9 } });
  });

  it("deleteSkill throws on a non-OK envelope", async () => {
    const del = vi.fn().mockResolvedValue({ data: { code: 5, msg: "no" } });
    await expect(deleteSkill(client({ delete: del }), 9)).rejects.toThrow();
  });
});
