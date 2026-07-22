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

import { SkillStatusSchema } from "@/features/skill/schemas/skill";
import {
  fetchSkillDetail,
  fetchSkills,
  fetchSkillStatus,
} from "@/features/skill/services/skills";
import { makeOkEnvelope } from "@/schemas/api";

function client(get: ReturnType<typeof vi.fn>): AxiosInstance {
  return { get } as Partial<AxiosInstance> as AxiosInstance;
}

describe("skills read services", () => {
  it("fetchSkills normalises to Paged<SkillItem>", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        skills: [
          {
            id: 1,
            agentId: "a",
            name: "S",
            description: "",
            version: "v",
            status: 2,
            assetId: 1,
            creatorUsername: "",
            failReason: "",
            projectId: 1,
            createdAt: 1,
            updatedAt: "2",
          },
        ],
        total: 1,
        hasNext: false,
      }),
    });
    const res = await fetchSkills(client(get), { agentId: "a" });
    expect(res.items).toHaveLength(1);
    expect(res.hasNext).toBe(false);
    expect(get).toHaveBeenCalledWith(
      "/skills/list",
      expect.objectContaining({
        params: expect.objectContaining({ agentId: "a" }),
      }),
    );
  });

  it("fetchSkillDetail returns skill + versions", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        skill: {
          id: 1,
          agentId: "a",
          name: "S",
          description: "",
          version: "v",
          projectId: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        versions: [],
      }),
    });
    const res = await fetchSkillDetail(client(get), 1);
    expect(res.skill.id).toBe(1);
    expect(get).toHaveBeenCalledWith("/skills", { params: { id: 1 } });
  });

  it("fetchSkillStatus returns the status enum value", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({ status: 2 }),
    });
    const res = await fetchSkillStatus(client(get), { id: 1, version: "v" });
    expect(res).toBe(SkillStatusSchema.enum.UPLOADED);
  });

  it("throws on a non-OK envelope code", async () => {
    const get = vi
      .fn()
      .mockResolvedValue({ data: { code: 101008, msg: "bad" } });
    await expect(fetchSkillDetail(client(get), 1)).rejects.toThrow();
  });
});
