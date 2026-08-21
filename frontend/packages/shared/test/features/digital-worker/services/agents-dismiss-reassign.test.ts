import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
  dismissAgentInstance,
  reassignAgentInstance,
} from "../../../../src/features/digital-worker/services/agents";

function makePostClient(response: unknown): {
  client: AxiosInstance;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn().mockResolvedValue({ data: response });
  const client = { post } as Partial<AxiosInstance> as AxiosInstance;
  return { client, post };
}

describe("dismissAgentInstance", () => {
  it("POSTs the id to the dismiss endpoint", async () => {
    const { client, post } = makePostClient({ code: 0, msg: "ok" });
    await dismissAgentInstance(client, { id: 9 });
    expect(post).toHaveBeenCalledWith("/agent/single_agent_instance/dismiss", {
      id: 9,
    });
  });

  it("rejects a non-OK envelope code", async () => {
    const { client } = makePostClient({ code: 101008, msg: "denied" });
    await expect(dismissAgentInstance(client, { id: 9 })).rejects.toThrow(
      /rejected \(code 101008\)/,
    );
  });
});

describe("reassignAgentInstance", () => {
  it("POSTs the id + new operator to the reassign endpoint", async () => {
    const { client, post } = makePostClient({ code: 0, msg: "ok" });
    await reassignAgentInstance(client, {
      id: 9,
      newOperatorUsername: "a@b.com",
    });
    expect(post).toHaveBeenCalledWith("/agent/single_agent_instance/reassign", {
      id: 9,
      newOperatorUsername: "a@b.com",
    });
  });

  it("rejects a non-OK envelope code", async () => {
    const { client } = makePostClient({ code: 101008, msg: "denied" });
    await expect(
      reassignAgentInstance(client, { id: 9, newOperatorUsername: "a@b.com" }),
    ).rejects.toThrow(/rejected \(code 101008\)/);
  });
});
