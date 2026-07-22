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

import {
  createConversation,
  getConversation,
  listConversations,
} from "../../../../src/features/chat/services/conversation";

function makeClient(response: unknown): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: response }),
    post: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

describe("createConversation", () => {
  it("POSTs to /conversation with the create body", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { id: 501, title: "Hi", agentInstanceInfo: { instanceId: 7 } },
    });
    await createConversation(client, { agentInstanceId: 7, title: "Hi" });
    expect(client.post).toHaveBeenCalledWith("/conversation", {
      agentInstanceId: 7,
      title: "Hi",
    });
  });

  it("returns the parsed conversation summary", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { id: 501, title: "Hi", agentInstanceInfo: { instanceId: 7 } },
    });
    const result = await createConversation(client, { agentInstanceId: 7 });
    expect(result).toEqual({
      id: 501,
      title: "Hi",
      createdAt: undefined,
      agentInstanceId: 7,
    });
  });

  it("throws on a non-OK envelope code", async () => {
    const client = makeClient({ code: 100006, msg: "boom" });
    await expect(
      createConversation(client, { agentInstanceId: 7 }),
    ).rejects.toThrow();
  });
});

describe("getConversation", () => {
  it("GETs /conversation with the id as a query param", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { conversation: { id: 501, title: "Weekly report" } },
    });
    await getConversation(client, 501);
    expect(client.get).toHaveBeenCalledWith("/conversation", {
      params: { id: 501 },
    });
  });

  it("unwraps data.conversation into the parsed summary", async () => {
    // The real dwp wire nests the record under `data.conversation` and carries
    // extra fields (status, metaData, creatorUsername, lastSectionId) the
    // summary schema ignores.
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: {
        conversation: {
          id: 501,
          title: "Weekly report",
          createdAt: 1710,
          agentInstanceInfo: { instanceId: 7, name: "Arena", role: "Tester" },
          status: 2,
          creatorUsername: "me",
          lastSectionId: "abc",
          metaData: { additionalProp1: "x" },
        },
      },
    });
    const result = await getConversation(client, 501);
    expect(result).toEqual({
      id: 501,
      title: "Weekly report",
      createdAt: 1710,
      agentInstanceId: 7,
    });
  });

  it("throws on a non-OK envelope code", async () => {
    const client = makeClient({ code: 100006, msg: "boom" });
    await expect(getConversation(client, 501)).rejects.toThrow();
  });
});

describe("listConversations", () => {
  it("GETs /conversation/list with agentInstanceId + default paging", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { conversations: [], hasMore: false },
    });
    await listConversations(client, 7);
    expect(client.get).toHaveBeenCalledWith("/conversation/list", {
      params: { agentInstanceId: 7, page: 1, pageSize: 20 },
    });
  });

  it("renames {conversations, hasMore} → {items, hasNext}", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: {
        conversations: [
          { id: 1, title: "A", agentInstanceInfo: { instanceId: 7 } },
        ],
        hasMore: true,
      },
    });
    const page = await listConversations(client, 7);
    expect(page.hasNext).toBe(true);
    expect(page.items).toEqual([
      { id: 1, title: "A", createdAt: undefined, agentInstanceId: 7 },
    ]);
  });

  it("throws on a non-OK envelope code", async () => {
    const client = makeClient({ code: 500, msg: "boom" });
    await expect(listConversations(client, 7)).rejects.toThrow();
  });
});
