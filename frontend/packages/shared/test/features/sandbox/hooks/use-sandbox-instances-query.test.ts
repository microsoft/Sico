import type { AxiosInstance } from "axios";
import { describe, expect, it } from "vitest";

import { sandboxInstancesQueryOptions } from "@/features/sandbox/hooks/use-sandbox-instances-query";
import type { Sandbox } from "@/features/sandbox/schemas/sandbox";

// Drive the `select` transform straight off the factory — it owns the
// filter+sort, the only logic worth pinning here (the fetch/poll is react-query).
const select = sandboxInstancesQueryOptions(413, {} as AxiosInstance).select;

function device(overrides: Partial<Sandbox>): Sandbox {
  return {
    sandboxId: "sb",
    displayName: "Device",
    type: "emulator",
    status: "in_use",
    vncUrl: "",
    ...overrides,
  };
}

describe("sandboxInstancesQueryOptions select", () => {
  it("keeps only available | assigned | in_use devices", () => {
    const out = select([
      device({ sandboxId: "a", status: "available" }),
      device({ sandboxId: "b", status: "terminated" }),
      device({ sandboxId: "c", status: "assigned" }),
      device({ sandboxId: "d", status: "in_use" }),
      device({ sandboxId: "e", status: "error" }),
    ]);
    expect(out.map((s) => s.sandboxId)).toEqual(["a", "c", "d"]);
  });

  it("matches the visible statuses case-insensitively", () => {
    // An oddly-cased wire status must still pass the filter (it maps to a badge
    // via toLowerCase downstream) rather than silently vanishing.
    const out = select([
      device({ sandboxId: "a", status: "In_Use" }),
      device({ sandboxId: "b", status: "AVAILABLE" }),
    ]);
    expect(out.map((s) => s.sandboxId)).toEqual(["a", "b"]);
  });

  it("sorts by displayName numerically (Device 2 before Device 10)", () => {
    const out = select([
      device({ sandboxId: "x", displayName: "Device 10" }),
      device({ sandboxId: "y", displayName: "Device 2" }),
    ]);
    expect(out.map((s) => s.displayName)).toEqual(["Device 2", "Device 10"]);
  });

  it("tie-breaks equal names by sandboxId", () => {
    const out = select([
      device({ sandboxId: "sb-2", displayName: "Phone" }),
      device({ sandboxId: "sb-1", displayName: "Phone" }),
    ]);
    expect(out.map((s) => s.sandboxId)).toEqual(["sb-1", "sb-2"]);
  });

  it("returns an empty list when nothing is visible", () => {
    expect(select([device({ status: "terminated" })])).toEqual([]);
  });
});
