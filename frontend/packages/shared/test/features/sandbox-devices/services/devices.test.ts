import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import {
  assignDevice,
  fetchDevices,
} from "../../../../src/features/sandbox-devices/services/devices";
import { makeOkEnvelope } from "../../../../src/schemas/api";

function makeGetClient(response: unknown): AxiosInstance {
  return {
    get: vi.fn().mockResolvedValue({ data: response }),
  } as Partial<AxiosInstance> as AxiosInstance;
}

function makeWireDevice(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sandbox_id: "sb-1",
    display_name: "Pixel 7",
    type: "emulator",
    status: "available",
    project_id: 7,
    instance_id: 0,
    instance_name: "",
    vnc_url: "https://vnc/1",
    ...overrides,
  };
}

describe("fetchDevices", () => {
  it("GETs /sandbox/list scoped to the project", async () => {
    const client = makeGetClient(
      makeOkEnvelope({ aio: [], emulator: [], physical: [], wincua: [] }),
    );
    await fetchDevices(client, 7);
    expect(client.get).toHaveBeenCalledWith("/sandbox/list", {
      params: { projectId: 7 },
    });
  });

  it("flattens the dict-of-arrays payload into a single Device[]", async () => {
    const client = makeGetClient(
      makeOkEnvelope({
        aio: [makeWireDevice({ sandbox_id: "aio-1", type: "aio" })],
        emulator: [makeWireDevice({ sandbox_id: "emu-1", type: "emulator" })],
        physical: [makeWireDevice({ sandbox_id: "phy-1", type: "physical" })],
        wincua: [makeWireDevice({ sandbox_id: "win-1", type: "wincua" })],
      }),
    );
    const devices = await fetchDevices(client, 7);
    expect(devices).toHaveLength(4);
    expect(devices.map((d) => d.sandboxId).sort()).toEqual([
      "aio-1",
      "emu-1",
      "phy-1",
      "win-1",
    ]);
  });

  it("maps snake_case wire fields to camelCase and keeps each device's type", async () => {
    const client = makeGetClient(
      makeOkEnvelope({
        aio: [],
        emulator: [
          makeWireDevice({
            sandbox_id: "emu-1",
            display_name: "Nova phone",
            type: "emulator",
            status: "assigned",
            instance_id: 42,
            instance_name: "Nova",
            vnc_url: "https://vnc/emu",
          }),
        ],
        physical: [],
        wincua: [],
      }),
    );
    const [device] = await fetchDevices(client, 7);
    expect(device).toEqual({
      sandboxId: "emu-1",
      displayName: "Nova phone",
      type: "emulator",
      status: "assigned",
      projectId: 7,
      instanceId: 42,
      instanceName: "Nova",
      vncUrl: "https://vnc/emu",
    });
  });

  it("tolerates a missing type bucket (defaults to empty group)", async () => {
    const client = makeGetClient(
      makeOkEnvelope({ emulator: [makeWireDevice()] }),
    );
    const devices = await fetchDevices(client, 7);
    expect(devices).toHaveLength(1);
  });

  it("throws on a non-OK envelope code", async () => {
    const client = makeGetClient({ code: 101008, msg: "denied" });
    await expect(fetchDevices(client, 7)).rejects.toThrow();
  });
});

describe("assignDevice", () => {
  function makePostClient(response: unknown): {
    client: AxiosInstance;
    post: ReturnType<typeof vi.fn>;
  } {
    const post = vi.fn().mockResolvedValue({ data: response });
    const client = { post } as Partial<AxiosInstance> as AxiosInstance;
    return { client, post };
  }

  it("POSTs snake_case {instance_id, sandbox_id} to /sandbox/assign", async () => {
    const { client, post } = makePostClient(makeOkEnvelope({}));
    await assignDevice(client, { instanceId: "42", sandboxId: "sb-1" });
    expect(post).toHaveBeenCalledWith("/sandbox/assign", {
      instance_id: "42",
      sandbox_id: "sb-1",
    });
  });

  it("rejects a non-OK envelope code (HTTP-200 permission denial)", async () => {
    const { client } = makePostClient({ code: 101008, msg: "denied" });
    await expect(
      assignDevice(client, { instanceId: "42", sandboxId: "sb-1" }),
    ).rejects.toThrow(/rejected \(code 101008\)/);
  });
});
