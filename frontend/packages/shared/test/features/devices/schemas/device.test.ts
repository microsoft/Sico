import { describe, expect, it } from "vitest";

import {
  deviceListDataSchema,
  deviceSchema,
  flattenDeviceGroups,
} from "@/features/devices";

function wireDevice(overrides: Record<string, unknown> = {}): unknown {
  return {
    sandbox_id: "sandbox-1",
    display_name: "Pixel 7",
    type: "emulator",
    status: "available",
    allocatable: true,
    organization_id: 9,
    project_id: 7,
    instance_id: "",
    instance_name: "",
    vnc_url: "https://vnc/1",
    ...overrides,
  };
}

describe("deviceSchema", () => {
  it("maps wire fields to the canonical device shape", () => {
    expect(deviceSchema.parse(wireDevice())).toEqual({
      sandboxId: "sandbox-1",
      displayName: "Pixel 7",
      type: "emulator",
      status: "available",
      allocatable: true,
      organizationId: 9,
      projectId: 7,
      instanceId: "",
      instanceName: "",
      vncUrl: "https://vnc/1",
    });
  });
});

describe("deviceListDataSchema", () => {
  it("normalizes nullable and missing buckets", () => {
    expect(deviceListDataSchema.parse({ emulator: null })).toEqual({
      emulator: [],
    });
  });
});

describe("flattenDeviceGroups", () => {
  it("flattens known buckets in display order", () => {
    const data = deviceListDataSchema.parse({
      wincua: [wireDevice({ sandbox_id: "win", type: "wincua" })],
      physical: [wireDevice({ sandbox_id: "physical", type: "physical" })],
      emulator: [wireDevice({ sandbox_id: "emulator" })],
      linux_workstation: [
        wireDevice({
          sandbox_id: "linux-workstation",
          type: "linux_workstation",
        }),
      ],
    });

    expect(flattenDeviceGroups(data).map(({ sandboxId }) => sandboxId)).toEqual(
      ["linux-workstation", "emulator", "physical", "win"],
    );
    expect(flattenDeviceGroups(data)[0]?.type).toBe("linux_workstation");
  });
});
