import { describe, expect, it } from "vitest";

import { DW_DEFAULT_AVATAR_URL, PROJECT_DEFAULT_AVATAR_URL } from "../src";

describe("DW_DEFAULT_AVATAR_URL", () => {
  it("resolves to a non-empty URL string", () => {
    expect(typeof DW_DEFAULT_AVATAR_URL).toBe("string");
    expect(DW_DEFAULT_AVATAR_URL.length).toBeGreaterThan(0);
  });
});

describe("PROJECT_DEFAULT_AVATAR_URL", () => {
  it("resolves to a non-empty URL string", () => {
    expect(typeof PROJECT_DEFAULT_AVATAR_URL).toBe("string");
    expect(PROJECT_DEFAULT_AVATAR_URL.length).toBeGreaterThan(0);
  });
});
