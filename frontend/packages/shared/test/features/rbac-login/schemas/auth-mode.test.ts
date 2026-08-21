import { describe, expect, it } from "vitest";

import {
  authModeSearchSchema,
  modeFromSearch,
  searchForMode,
} from "@/features/rbac-login/schemas/auth-mode";

describe("authModeSearchSchema", () => {
  it("accepts only the developer URL mode", () => {
    expect(authModeSearchSchema.parse({})).toEqual({});
    expect(authModeSearchSchema.parse({ mode: "developer" })).toEqual({
      mode: "developer",
    });
    expect(() => authModeSearchSchema.parse({ mode: "operator" })).toThrow();
  });
});

describe("mode helpers", () => {
  it("maps URL search values to canonical login modes", () => {
    expect(modeFromSearch({})).toBe("operator");
    expect(modeFromSearch({ mode: "developer" })).toBe("developer");
  });

  it("serializes operator mode without a mode query param", () => {
    expect(searchForMode("operator")).toEqual({ mode: undefined });
    expect(searchForMode("developer")).toEqual({ mode: "developer" });
  });
});
