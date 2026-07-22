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

import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { fetchAgentDetail } from "@/features/digital-worker/services/agents";

function makeClient(response: unknown): {
  client: ReturnType<typeof axios.create>;
  mock: MockAdapter;
} {
  const client = axios.create({ baseURL: "/api/sico" });
  const mock = new MockAdapter(client);
  mock.onGet("/agent/single_agent_instance").reply(200, response);
  return { client, mock };
}

describe("fetchAgentDetail", () => {
  it("parses the data.instance double envelope", async () => {
    const { client, mock } = makeClient({
      code: 0,
      msg: "ok",
      data: { instance: { id: 7, name: "Ada", role: "Engineer", iconUri: "" } },
    });
    const agent = await fetchAgentDetail(client, 7);
    expect(agent).toMatchObject({ id: 7, name: "Ada", role: "Engineer" });
    expect(mock.history.get[0]?.url).toBe("/agent/single_agent_instance");
    expect(mock.history.get[0]?.params).toEqual({ id: 7 });
  });

  it("throws when the instance is missing", async () => {
    const { client } = makeClient({ code: 0, msg: "ok", data: {} });
    await expect(fetchAgentDetail(client, 7)).rejects.toBeInstanceOf(Error);
  });

  it("throws when data is omitted from the envelope", async () => {
    // `data` optional in `apiResponseSchema` → envelope parses, so the
    // function's own `if (!parsed.data)` guard runs (distinct from the
    // required-`instance` schema check above). Assert the guard message:
    // a manually-built `ZodError` isn't `instanceof Error` in Zod 4, unlike
    // a `.parse()`-thrown one — mirror the `fetchAgents` sibling test.
    const { client } = makeClient({ code: 1, msg: "error" });
    await expect(fetchAgentDetail(client, 7)).rejects.toThrow(/missing data/);
  });
});
