import { describe, expect, it } from "vitest";

import { ownsAsset } from "@/features/projects/components/assets-table-rows";
import type { AssetCreator } from "@/features/projects/types";

// `ownsAsset` is the `.own` delete check: a Knowledge doc is owned by its
// uploading user (`creatorUsername`); a Deliverable/Experience is owned by the
// human operator who ran the authoring DW (`operatorUsername`, per the PRD "DW
// Operator may delete"). It must fail CLOSED on an unknown identity or an older
// row that predates the backend operator field.
const EMAIL = "me@company.com";

describe("ownsAsset", () => {
  it("owns a user-created asset whose creatorUsername matches", () => {
    const creator: AssetCreator = { kind: "user", username: EMAIL };
    expect(ownsAsset(creator, EMAIL)).toBe(true);
  });

  it("does NOT own a user-created asset by another uploader", () => {
    const creator: AssetCreator = { kind: "user", username: "other@x.com" };
    expect(ownsAsset(creator, EMAIL)).toBe(false);
  });

  it("owns an agent-produced asset whose operatorUsername matches", () => {
    const creator: AssetCreator = { kind: "agent", operatorUsername: EMAIL };
    expect(ownsAsset(creator, EMAIL)).toBe(true);
  });

  it("does NOT own an agent-produced asset run by another operator", () => {
    const creator: AssetCreator = {
      kind: "agent",
      operatorUsername: "other@x.com",
    };
    expect(ownsAsset(creator, EMAIL)).toBe(false);
  });

  it("fails closed when the agent row has no operator (older data)", () => {
    const creator: AssetCreator = { kind: "agent", agentName: "Max" };
    expect(ownsAsset(creator, EMAIL)).toBe(false);
  });

  it("fails closed when the user identity is not hydrated", () => {
    const creator: AssetCreator = { kind: "user", username: EMAIL };
    expect(ownsAsset(creator, null)).toBe(false);
  });

  it("owns despite an email-casing difference between the fields", () => {
    // The backend username/email are distinct columns; a casing mismatch must
    // not silently drop the owner's delete affordance.
    const creator: AssetCreator = { kind: "user", username: "Me@Company.com" };
    expect(ownsAsset(creator, EMAIL)).toBe(true);
  });
});
