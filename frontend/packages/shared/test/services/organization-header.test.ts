import { describe, expect, it } from "vitest";

import { getOrganizationHeaders } from "@/services/organization-header";

describe("getOrganizationHeaders", () => {
  it("serializes a positive integer organization ID", () => {
    expect(getOrganizationHeaders(() => 42)).toEqual({
      "X-Sico-Organization-ID": "42",
    });
  });

  it("omits the header without a getter", () => {
    expect(getOrganizationHeaders()).toEqual({});
  });

  it.each([
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("omits an absent or invalid organization ID: %s", (organizationId) => {
    expect(getOrganizationHeaders(() => organizationId)).toEqual({});
  });
});
