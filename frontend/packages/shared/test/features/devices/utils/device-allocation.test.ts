import { describe, expect, it } from "vitest";

import {
  buildDeviceSummary,
  categoryForDevice,
  type Device,
  getAllocationBounds,
  planDeviceAllocation,
  projectDeviceCounts,
} from "@/features/devices";

function device(overrides: Partial<Device>): Device {
  return {
    sandboxId: "sandbox-1",
    displayName: "Device",
    type: "emulator",
    status: "available",
    allocatable: true,
    organizationId: 9,
    projectId: 0,
    instanceId: "",
    instanceName: "",
    vncUrl: "",
    ...overrides,
  };
}

describe("categoryForDevice", () => {
  it.each([
    ["emulator", "mobile"],
    ["wincua", "windows"],
    ["physical", "windows"],
    ["linux_workstation", null],
    ["future", null],
  ] as const)("maps %s to %s", (type, category) => {
    expect(categoryForDevice(type)).toBe(category);
  });
});

describe("device statistics", () => {
  const devices = [
    device({ sandboxId: "m-free", type: "emulator" }),
    device({ sandboxId: "m-project", type: "emulator", projectId: 7 }),
    device({ sandboxId: "w-free", type: "wincua" }),
    device({ sandboxId: "w-busy", type: "physical", projectId: 7 }),
    device({ sandboxId: "w-unhealthy", type: "physical", allocatable: false }),
    device({ sandboxId: "linux", type: "linux_workstation" }),
  ];

  it("derives organization totals and available counts", () => {
    expect(buildDeviceSummary(devices)).toEqual({
      mobile: { total: 2, available: 1 },
      windows: { total: 3, available: 1 },
    });
  });

  it("groups device counts by project", () => {
    expect(projectDeviceCounts(devices, 7)).toEqual({ mobile: 1, windows: 1 });
  });
});

describe("device allocation planning", () => {
  const devices = [
    device({ sandboxId: "m-available", type: "emulator" }),
    device({
      sandboxId: "m-locked",
      type: "emulator",
      projectId: 7,
      instanceId: "dw-1",
    }),
    device({ sandboxId: "m-removable", type: "emulator", projectId: 7 }),
    device({ sandboxId: "w-available-a", type: "physical" }),
    device({ sandboxId: "w-available-b", type: "wincua" }),
    device({ sandboxId: "w-current", type: "wincua", projectId: 7 }),
  ];

  it("derives category allocation bounds", () => {
    expect(getAllocationBounds(devices, 7, "mobile")).toEqual({
      current: 2,
      minimum: 0,
      maximum: 3,
      available: 1,
    });
  });

  it("selects deterministic IDs for increases and decreases", () => {
    expect(planDeviceAllocation(devices, 7, { mobile: 1, windows: 3 })).toEqual(
      {
        assignIds: ["w-available-a", "w-available-b"],
        unassignIds: ["m-removable"],
      },
    );
  });

  it("removes instance-bound devices after unbound devices", () => {
    expect(planDeviceAllocation(devices, 7, { mobile: 0, windows: 1 })).toEqual(
      {
        assignIds: [],
        unassignIds: ["m-removable", "m-locked"],
      },
    );
  });

  it("rejects a target above available capacity", () => {
    expect(() =>
      planDeviceAllocation(devices, 7, { mobile: 3, windows: 4 }),
    ).toThrow(RangeError);
  });
});
