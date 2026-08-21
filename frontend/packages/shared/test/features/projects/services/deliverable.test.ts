import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDeliverableToProject } from "@/features/projects/services/deliverable";
import { makeOkEnvelope } from "@/schemas/api";

function makeClient(post: ReturnType<typeof vi.fn>): AxiosInstance {
  return { post } as unknown as AxiosInstance;
}

const post = vi.fn();
const apiClient = makeClient(post);

beforeEach(() => {
  post.mockReset();
});

describe("addDeliverableToProject", () => {
  it("POSTs /project/deliverable with the projectId, agentInstanceId, fileUri, fileName", async () => {
    post.mockResolvedValue({ data: makeOkEnvelope({}) });
    await addDeliverableToProject(apiClient, {
      projectId: 84,
      agentInstanceId: 601,
      fileUri: "default_space/0/hello.md",
      fileName: "hello.md",
    });
    expect(post).toHaveBeenCalledWith("/project/deliverable", {
      projectId: 84,
      agentInstanceId: 601,
      fileUri: "default_space/0/hello.md",
      fileName: "hello.md",
    });
  });

  it("rejects on a non-OK envelope code", async () => {
    post.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(
      addDeliverableToProject(apiClient, {
        projectId: 84,
        agentInstanceId: 601,
        fileUri: "default_space/0/hello.md",
        fileName: "hello.md",
      }),
    ).rejects.toThrow();
  });
});
