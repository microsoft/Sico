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

import { fetchHistory } from "../../../../src/features/chat/services/history";

function makeClient(response: unknown): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

describe("fetchHistory", () => {
  it("requests /conversation/messages with agentInstanceId + default page=1 pageSize=5", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { messages: [], hasMore: false },
    });
    await fetchHistory(client, {
      agentInstanceId: 7,
      messagesPath: "/conversation/messages",
    });
    expect(client.get).toHaveBeenCalledWith("/conversation/messages", {
      params: { agentInstanceId: 7, page: 1, pageSize: 5 },
    });
  });

  it("passes a non-default page through to the request params", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { messages: [], hasMore: false },
    });
    await fetchHistory(client, {
      agentInstanceId: 7,
      page: 3,
      messagesPath: "/conversation/messages",
    });
    expect(client.get).toHaveBeenCalledWith("/conversation/messages", {
      params: { agentInstanceId: 7, page: 3, pageSize: 5 },
    });
  });

  it("parses each wire item via messageItemSchema (newest-first order preserved)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: {
        messages: [
          {
            messageId: 100,
            turnId: 9,
            role: "assistant",
            type: 1,
            content: "newest",
          },
          { messageId: 99, turnId: 8, role: "user", type: 1, content: "older" },
        ],
        hasMore: true,
      },
    });
    const result = await fetchHistory(client, {
      agentInstanceId: 7,
      messagesPath: "/conversation/messages",
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.id).toBe("100");
    expect(result.items[0]!.author).toBe("ai");
    expect(result.items[0]!.content[0]).toEqual({
      partId: "100:0",
      type: "text",
      text: "newest",
    });
    expect(result.items[1]!.author).toBe("human");
    expect(result.hasNext).toBe(true);
  });

  it("returns hasNext=false when the server reports hasMore=false", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { messages: [], hasMore: false },
    });
    const result = await fetchHistory(client, {
      agentInstanceId: 7,
      messagesPath: "/conversation/messages",
    });
    expect(result.hasNext).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it("clamps pageSize to backend max (50)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { messages: [], hasMore: false },
    });
    await fetchHistory(client, {
      agentInstanceId: 1,
      pageSize: 200,
      messagesPath: "/conversation/messages",
    });
    expect(client.get).toHaveBeenCalledWith("/conversation/messages", {
      params: { agentInstanceId: 1, page: 1, pageSize: 50 },
    });
  });

  it("throws a ZodError when the envelope has a non-zero code and no data", async () => {
    const client = makeClient({ code: 500, msg: "boom" });
    await expect(
      fetchHistory(client, {
        agentInstanceId: 1,
        messagesPath: "/conversation/messages",
      }),
    ).rejects.toThrow(/rejected \(code 500\)/);
  });

  it("the returned page omits `total` (endpoint carries no count)", async () => {
    const client = makeClient({
      code: 0,
      msg: "ok",
      data: { messages: [], hasMore: false },
    });
    const result = await fetchHistory(client, {
      agentInstanceId: 7,
      messagesPath: "/conversation/messages",
    });
    expect("total" in result).toBe(false);
  });
});
