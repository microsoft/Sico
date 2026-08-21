import { describe, expect, it } from "vitest";

import { sameIdentity } from "@/features/projects/utils/same-identity";

// `sameIdentity` backs the `.own` UX gate: it compares a backend identity field
// against the current user's email, case-insensitively, and fails closed on any
// missing/empty side.
describe("sameIdentity", () => {
  it("matches identical values", () => {
    expect(sameIdentity("me@x.com", "me@x.com")).toBe(true);
  });

  it("matches across an email-casing difference", () => {
    expect(sameIdentity("Me@X.com", "me@x.com")).toBe(true);
  });

  it("does not match different identities", () => {
    expect(sameIdentity("other@x.com", "me@x.com")).toBe(false);
  });

  it("fails closed on a null candidate", () => {
    expect(sameIdentity(null, "me@x.com")).toBe(false);
  });

  it("fails closed on an undefined candidate (older row, absent field)", () => {
    expect(sameIdentity(undefined, "me@x.com")).toBe(false);
  });

  it("fails closed on an empty-string candidate", () => {
    expect(sameIdentity("", "me@x.com")).toBe(false);
  });

  it("fails closed when the user identity is not hydrated", () => {
    expect(sameIdentity("me@x.com", null)).toBe(false);
  });
});
