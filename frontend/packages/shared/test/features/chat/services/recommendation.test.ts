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
