import { describe, expect, it } from "vitest";

import { assetSearchSchema } from "@/features/projects/schemas/asset-search";

describe("assetSearchSchema", () => {
  it("fills the two defaults from an empty object (category is a route path now)", () => {
    expect(assetSearchSchema.parse({})).toEqual({
      sort: "desc",
      q: "",
    });
  });

  it("preserves provided values", () => {
    expect(assetSearchSchema.parse({ sort: "asc", q: "refund" })).toEqual({
      sort: "asc",
      q: "refund",
    });
  });

  it("ignores an extraneous tab key (no longer part of the search schema)", () => {
    expect(assetSearchSchema.parse({ tab: "knowledge" })).toEqual({
      sort: "desc",
      q: "",
    });
  });
});
