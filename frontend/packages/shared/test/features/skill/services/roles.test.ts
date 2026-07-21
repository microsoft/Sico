import type { AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";

import { fetchRoles } from "@/features/skill/services/roles";
import { makeOkEnvelope } from "@/schemas/api";

describe("fetchRoles", () => {
  it("returns the normalised role array", async () => {
    const get = vi.fn().mockResolvedValue({
      data: makeOkEnvelope({ role: ["Tester"] }),
    });
    const apiClient = { get } as Partial<AxiosInstance> as AxiosInstance;
    const roles = await fetchRoles(apiClient);
    expect(roles).toEqual([{ name: "Tester", value: "Tester" }]);
    expect(get).toHaveBeenCalledWith("/agent/roles");
  });
});
