import { describe, expect, it } from "vitest";

import {
  organizationDetailSchema,
  organizationSummarySchema,
} from "@/features/organization/schemas/organization";

const organization = {
  id: 9,
  name: "SICO",
  description: "Symbiotic intelligence",
  createdAt: 1_754_000_000,
  updatedAt: 1_754_000_100,
};

describe("organizationSummarySchema", () => {
  it("preserves an organization icon URL", () => {
    const parsed = organizationSummarySchema.parse({
      ...organization,
      iconUrl: "https://assets.example.test/organizations/9/avatar.png",
      creatorUsername: "creator@example.com",
      roleCodes: ["org_admin"],
      isOwner: true,
    });

    expect(parsed.iconUrl).toBe(
      "https://assets.example.test/organizations/9/avatar.png",
    );
  });

  it("rejects an invalid organization icon URL type", () => {
    const parsed = organizationSummarySchema.safeParse({
      ...organization,
      iconUrl: 9,
      creatorUsername: "creator@example.com",
      roleCodes: ["org_admin"],
      isOwner: true,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("organizationDetailSchema", () => {
  it("preserves an organization icon URL", () => {
    const parsed = organizationDetailSchema.parse({
      ...organization,
      iconUrl: "https://assets.example.test/organizations/9/avatar.png",
    });

    expect(parsed.iconUrl).toBe(
      "https://assets.example.test/organizations/9/avatar.png",
    );
  });

  it("rejects an invalid organization icon URL type", () => {
    const parsed = organizationDetailSchema.safeParse({
      ...organization,
      iconUrl: {},
    });

    expect(parsed.success).toBe(false);
  });
});
