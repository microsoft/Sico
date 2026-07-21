import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { fetchRecommendationTasks } from "../../../../src/features/chat/services/recommendation";

function makeClient(response: unknown): AxiosInstance {
  return {
    post: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

describe("fetchRecommendationTasks", () => {
  it("POSTs the onboarding endpoint with agentInstanceId in the body", async () => {
    const client = makeClient({ code: 0, msg: "ok", data: { tasks: [] } });
    await fetchRecommendationTasks(client, 42);
    expect(client.post).toHaveBeenCalledWith(
      "/conversation/onboard/recommendation_tasks",
      { agentInstanceId: 42 },
    );
  });

  it("unwraps the envelope and returns the bare tasks array", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { tasks: [{ message: "Automate regression", icon: 2 }] },
    });
    const tasks = await fetchRecommendationTasks(client, 1);
    expect(tasks).toEqual([{ message: "Automate regression", icon: 2 }]);
  });

  it("throws on a non-OK envelope code", async () => {
    const client = makeClient({ code: 101008, msg: "denied" });
    await expect(fetchRecommendationTasks(client, 1)).rejects.toThrow();
  });

  it("throws on an off-contract body", async () => {
    const client = makeClient({ code: 0, msg: "ok", data: { tasks: "nope" } });
    await expect(fetchRecommendationTasks(client, 1)).rejects.toThrow();
  });
});
