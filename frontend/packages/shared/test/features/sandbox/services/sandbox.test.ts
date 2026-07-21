import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSandboxInstances } from "@/features/sandbox/services/sandbox";
import { makeOkEnvelope } from "@/schemas/api";

function makeClient(get: ReturnType<typeof vi.fn>): AxiosInstance {
  return { get } as unknown as AxiosInstance;
}

const get = vi.fn();
const apiClient = makeClient(get);

const rawDevice = {
  sandboxId: "sb-1",
  displayName: "Pixel 7",
  type: "emulator",
  status: "in_use",
  vncUrl: "https://vnc.example/sb-1",
};

beforeEach(() => {
  get.mockReset();
});

describe("fetchSandboxInstances", () => {
  it("GETs /sandbox/instance with the agent instance id as a string param", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({ items: [rawDevice] }) });
    await fetchSandboxInstances(apiClient, 413);
    expect(get).toHaveBeenCalledWith("/sandbox/instance", {
      params: { instanceId: "413" },
    });
  });

  it("unwraps the envelope to the device items array", async () => {
    get.mockResolvedValue({ data: makeOkEnvelope({ items: [rawDevice] }) });
    const items = await fetchSandboxInstances(apiClient, 413);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sandboxId: "sb-1", type: "emulator" });
  });

  it("defaults a missing items list to empty (one bad field never blanks the list)", async () => {
    // `items` absent → schema `.catch([])` keeps the parse alive.
    get.mockResolvedValue({ data: makeOkEnvelope({}) });
    const items = await fetchSandboxInstances(apiClient, 413);
    expect(items).toEqual([]);
  });

  it("rejects on a non-OK envelope code", async () => {
    get.mockResolvedValue({ data: { code: 101008, msg: "denied" } });
    await expect(fetchSandboxInstances(apiClient, 413)).rejects.toThrow();
  });
});
