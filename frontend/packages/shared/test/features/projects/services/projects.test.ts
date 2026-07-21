import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  fetchProjectDetail,
  fetchProjects,
  updateProject,
} from "@/features/projects/services/projects";
import { makeOkEnvelope } from "@/schemas/api";

function makeClient(
  get: ReturnType<typeof vi.fn>,
  put: ReturnType<typeof vi.fn>,
): AxiosInstance {
  return { get, put } as Partial<AxiosInstance> as AxiosInstance;
}

const sampleProject = {
  id: 1,
  name: "Atlas",
  description: "d",
  iconUrl: "i",
  memberType: 3,
  agentInstances: [],
};

const sampleProjectDetail = {
  ...sampleProject,
  ownerUsername: "alice",
  creatorUsername: "bob",
  operatorAdmins: ["alice", "bob"],
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_001,
};

const get = vi.fn();
const put = vi.fn();
const apiClient = makeClient(get, put);

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

describe("fetchProjects", () => {
  it("issues GET with default params and returns { items, total, hasNext }", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        projects: [sampleProject],
        total: 1,
        hasNext: false,
      }),
    });
    const result = await fetchProjects(apiClient, {});
    expect(get).toHaveBeenCalledWith("/project/user_projects", {
      params: { page: 1, pageSize: 50, memberType: 3 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hasNext).toBe(false);
  });

  it("passes explicit page / pageSize / memberType params", async () => {
    get.mockResolvedValue({
      data: makeOkEnvelope({
        projects: [],
        total: 0,
        hasNext: false,
      }),
    });
    await fetchProjects(apiClient, {
      page: 2,
      pageSize: 25,
      memberType: 2,
    });
    expect(get).toHaveBeenCalledWith("/project/user_projects", {
      params: { page: 2, pageSize: 25, memberType: 2 },
    });
  });

  it("throws when the response fails zod validation", async () => {
    get.mockResolvedValue({ data: { totally: "wrong" } });
    await expect(fetchProjects(apiClient, {})).rejects.toThrow();
  });
});

describe("fetchProjectDetail", () => {
  it("issues GET /project with { params: { id } } and returns the detail", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope(sampleProjectDetail) });
    const result = await fetchProjectDetail(apiClient, 1);
    expect(get).toHaveBeenCalledWith("/project", { params: { id: 1 } });
    expect(result.operatorAdmins).toEqual(["alice", "bob"]);
    expect(result.ownerUsername).toBe("alice");
  });

  it("throws when the detail response fails zod validation", async () => {
    get.mockResolvedValue({ data: { totally: "wrong" } });
    await expect(fetchProjectDetail(apiClient, 1)).rejects.toThrow();
  });
});

describe("updateProject", () => {
  it("issues PUT /project with the exact body (incl. operatorAdmins) and returns the id", async () => {
    put.mockResolvedValue({ data: makeOkEnvelope({ id: 7 }) });
    const body = {
      id: 7,
      name: "Renamed",
      description: "new",
      iconUri: "/storage/x.svg",
      operatorAdmins: ["alice", "bob"],
    };
    const result = await updateProject(apiClient, body);
    expect(put).toHaveBeenCalledWith("/project", body);
    expect(result).toBe(7);
  });
});

describe("createProject", () => {
  it("issues POST /project with name/description/iconUri + empty operatorAdmins and returns the id", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: makeOkEnvelope({ id: 42 }) });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    const result = await createProject(client, {
      name: "Aurora",
      description: "launch",
    });
    expect(post).toHaveBeenCalledWith("/project", {
      name: "Aurora",
      description: "launch",
      iconUri: "",
      operatorAdmins: [],
    });
    expect(result).toBe(42);
  });

  it("throws on a non-OK envelope code", async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ data: { code: 101_008, msg: "denied" } });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    await expect(createProject(client, { name: "X" })).rejects.toThrow();
  });
});
