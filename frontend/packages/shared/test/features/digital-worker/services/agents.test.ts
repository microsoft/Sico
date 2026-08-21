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
  it("requests page + pageSize + default activity sort (no user/project scope)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 2 });
    expect(client.get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: {
        page: 2,
        pageSize: 30,
        orderBy: 3,
        sortOrder: 1,
      },
    });
  });

  it("adds operatorUsername when scoped to a user's own DWs", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 1, operatorUsername: "me@x.com" });
    expect(client.get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: {
        page: 1,
        pageSize: 30,
        orderBy: 3,
        sortOrder: 1,
        operatorUsername: "me@x.com",
      },
    });
  });

  it("adds projectId to the params when scoped to a project", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 1, projectId: 42 });
    expect(client.get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: {
        page: 1,
        pageSize: 30,
        orderBy: 3,
        sortOrder: 1,
        projectId: 42,
      },
    });
  });

  it("omits statusList when none is given (backend returns all statuses)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 1 });
    const params = vi.mocked(client.get).mock.calls[0]?.[1]?.params;
    expect(params).not.toHaveProperty("statusList");
  });

  it("omits statusList when the array is empty (show-all)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, { page: 1, statusList: [] });
    const params = vi.mocked(client.get).mock.calls[0]?.[1]?.params;
    expect(params).not.toHaveProperty("statusList");
  });

  it("joins statusList to CSV when provided (hide-inactive filter)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { instances: [], total: 0, hasNext: false },
    });
    await fetchAgents(client, {
      page: 1,
      statusList: [
        AgentStatusSchema.enum.ONBOARDING,
        AgentStatusSchema.enum.NEW,
        AgentStatusSchema.enum.ACTIVE,
        AgentStatusSchema.enum.ABORTED,
        AgentStatusSchema.enum.ONBOARDING_SAVED,
      ],
    });
    expect(client.get).toHaveBeenCalledWith("/agent/single_agent_instances", {
      params: {
        page: 1,
        pageSize: 30,
        orderBy: 3,
        sortOrder: 1,
        statusList: "1,2,3,5,7",
      },
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
      params: {
        page: 1,
        pageSize: 50,
        orderBy: 3,
        sortOrder: 1,
      },
    });
  });

  it("throws when envelope has no data", async () => {
    const client = makeClient({ code: 500, msg: "boom" });
    await expect(fetchAgents(client, { page: 1 })).rejects.toThrow(
      /missing data/,
    );
  });

  it("throws on the 'agent not found' (100004) code so it surfaces the error UI", async () => {
    // Decision: 100004 shows the ErrorView (via the DW-tab ErrorBoundary), not
    // an empty state — the backend sends no `data`, so it throws like any other
    // non-OK envelope.
    const client = makeClient({ code: 100_004, msg: "agent not found" });
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
