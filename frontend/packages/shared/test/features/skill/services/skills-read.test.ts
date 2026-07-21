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
