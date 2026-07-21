import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { fetchAgentInfos } from "@/features/studio/services/single-agents";
import { makeOkEnvelope } from "@/schemas/api";

describe("fetchAgentInfos", () => {
  it("returns the unwrapped agent card array", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({
        agentInfos: [
          {
            agentId: "1",
            name: "Atlas",
            role: "Researcher",
            creatorUsername: "alice",
          },
        ],
      }),
    });
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    const agents = await fetchAgentInfos(apiClient);
    expect(agents).toEqual([
      {
        agentId: "1",
        name: "Atlas",
        role: "Researcher",
        creatorUsername: "alice",
      },
    ]);
    expect(get).toHaveBeenCalledWith("/agent/single_agent_infos");
  });
});
