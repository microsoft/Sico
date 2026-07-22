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
