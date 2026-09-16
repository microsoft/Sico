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

  it("rejects a successful envelope without data", async () => {
    const { client } = makeClient({ code: 0, msg: "ok" });
    await expect(fetchAgentDetail(client, 7)).rejects.toThrow(/missing data/);
  });

  it.each([undefined, null, {}])(
    "preserves a business failure before validating data %j",
    async (data) => {
      const { client } = makeClient({
        code: 100001,
        msg: "Request parameters are invalid",
        ...(data === undefined ? {} : { data }),
      });

      await expect(fetchAgentDetail(client, 7)).rejects.toMatchObject({
        name: "EnvelopeError",
        code: 100001,
        msg: "Request parameters are invalid",
      });
    },
  );
});
