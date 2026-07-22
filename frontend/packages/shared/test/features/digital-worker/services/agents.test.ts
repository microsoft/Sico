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

import { AgentStatusSchema } from "../../../../src/features/digital-worker/schemas/agent";
import {
  createAgentInstance,
  fetchAgents,
  updateAgentInstanceStatus,
} from "../../../../src/features/digital-worker/services/agents";

function makeClient(response: unknown): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

describe("fetchAgents", () => {
  it("requests the correct page + pageSize + isEmployer=false", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 2 });
    expect(client.get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: { page: 2, pageSize: 30, isEmployer: false },
    });
  });

  it("returns server-provided hasNext=true", async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      name: `A${i}`,
    }));
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: items, total: 100, hasNext: true },
    });
    const result = await fetchAgents(client, { page: 1 });
    expect(result.items).toHaveLength(30);
    expect(result.total).toBe(100);
    expect(result.hasNext).toBe(true);
  });

  it("returns server-provided hasNext=false", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: {
        instances: [{ id: 1, name: "A" }],
        total: 1,
        hasNext: false,
      },
    });
    const result = await fetchAgents(client, { page: 1 });
    expect(result.hasNext).toBe(false);
    expect(result.total).toBe(1);
  });

  it("clamps pageSize to backend max (50)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 1, pageSize: 200 });
    expect(client.get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: { page: 1, pageSize: 50, isEmployer: false },
    });
  });

  it("throws when envelope has no data", async () => {
    const client = makeClient({ code: 500, msg: "boom" });
    await expect(fetchAgents(client, { page: 1 })).rejects.toThrow(
      /missing data/,
    );
  });
});

describe("updateAgentInstanceStatus", () => {
  function makePutClient(response: unknown): {
    client: AxiosInstance;
    put: ReturnType<typeof vi.fn>;
  } {
    const put = vi.fn().mockResolvedValue({ data: response });
    const client = {
      put,
    } as Partial<AxiosInstance> as AxiosInstance;
    return { client, put };
  }

  it("PUTs the id + status to the status endpoint", async () => {
    const { client, put } = makePutClient({ code: 0, msg: "ok" });
    await updateAgentInstanceStatus(client, {
      id: 7,
      status: AgentStatusSchema.enum.ACTIVE,
    });
    expect(put).toHaveBeenCalledWith("/agent/single_agent_instance/status", {
      id: 7,
      status: AgentStatusSchema.enum.ACTIVE,
    });
  });

  it("rejects a non-OK envelope code (HTTP-200 permission denial)", async () => {
    // Backend signals failure as a non-zero `code` inside an HTTP-200 envelope;
    // axios resolves it, so the service must reject on `code` itself.
    const { client } = makePutClient({ code: 101008, msg: "denied" });
    await expect(
      updateAgentInstanceStatus(client, {
        id: 7,
        status: AgentStatusSchema.enum.ACTIVE,
      }),
    ).rejects.toThrow(/rejected \(code 101008\)/);
  });
});

describe("createAgentInstance", () => {
  it("POSTs agentId/employerUsername/name/projectId/role and returns the created instance", async () => {
    const post = vi.fn().mockResolvedValue({
      data: {
        code: 0,
        msg: "ok",
        data: { id: 9, agentId: "tmpl-1", employerUsername: "a@b.com" },
      },
    });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    const result = await createAgentInstance(client, {
      agentId: "tmpl-1",
      employerUsername: "a@b.com",
      name: "Nova",
      projectId: 7,
      role: "Researcher",
      iconUri: "https://cdn/av.png",
    });
    expect(post).toHaveBeenCalledWith("/agent/single_agent_instance", {
      agentId: "tmpl-1",
      employerUsername: "a@b.com",
      name: "Nova",
      projectId: 7,
      role: "Researcher",
      iconUri: "https://cdn/av.png",
    });
    expect(result.id).toBe(9);
  });

  it("throws on a non-OK envelope code", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    await expect(
      createAgentInstance(client, {
        agentId: "t",
        employerUsername: "a@b.com",
        name: "N",
        projectId: 7,
      }),
    ).rejects.toThrow();
  });
});
