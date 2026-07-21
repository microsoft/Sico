import { describe, expect, it } from "vitest";

import {
  DEVELOPER_HOME,
  homeForMode,
  OPERATOR_HOME,
  resolveModeRedirect,
} from "@/utils/resolve-mode-redirect";

describe("homeForMode", () => {
  it("lands operator on the workspace", () => {
    expect(homeForMode("operator")).toBe(OPERATOR_HOME);
  });

  it("lands developer on the studio", () => {
    expect(homeForMode("developer")).toBe(DEVELOPER_HOME);
  });
});

// Matrix: {operator, developer} × {operator-only, developer-only, shared}.
describe("resolveModeRedirect", () => {
  it("allows a shared route (no declared modes) in operator mode", () => {
    expect(resolveModeRedirect("operator", [undefined, undefined])).toBeNull();
  });

  it("allows a shared route (no declared modes) in developer mode", () => {
    expect(resolveModeRedirect("developer", [undefined, undefined])).toBeNull();
  });

  it("allows operator on an operator-only route", () => {
    expect(resolveModeRedirect("operator", [["operator"]])).toBeNull();
  });

  it("allows developer on a developer-only route", () => {
    expect(resolveModeRedirect("developer", [["developer"]])).toBeNull();
  });

  it("redirects developer off an operator-only route to the studio", () => {
    expect(resolveModeRedirect("developer", [["operator"]])).toBe(
      DEVELOPER_HOME,
    );
  });

  it("redirects operator off a developer-only route to the workspace", () => {
    expect(resolveModeRedirect("operator", [["developer"]])).toBe(
      OPERATOR_HOME,
    );
  });

  it("uses the deepest declared restriction (leaf wins over ancestor)", () => {
    // ancestor allows both, leaf narrows to developer-only.
    expect(resolveModeRedirect("operator", [undefined, ["developer"]])).toBe(
      OPERATOR_HOME,
    );
  });

  it("ignores shallower undefined matches when a deeper one is declared", () => {
    expect(
      resolveModeRedirect("developer", [["developer"], undefined]),
    ).toBeNull();
  });
});
