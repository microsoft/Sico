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
