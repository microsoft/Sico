import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "@/utils/is-same-origin-request";

// jsdom defaults `window.location.origin` to `http://localhost:3000`.

describe("isSameOriginRequest", () => {
  it("returns false for an undefined request URL", () => {
    expect(isSameOriginRequest(undefined, undefined)).toBe(false);
  });

  it("treats a relative path as same-origin", () => {
    expect(isSameOriginRequest("/api/sico/x", undefined)).toBe(true);
  });

  it("treats an absolute same-origin URL as same-origin", () => {
    expect(
      isSameOriginRequest(`${window.location.origin}/api/sico/x`, undefined),
    ).toBe(true);
  });

  it("treats an absolute cross-origin URL as cross-origin", () => {
    expect(
      isSameOriginRequest("https://evil.example.com/leak", undefined),
    ).toBe(false);
  });

  it("treats a protocol-relative cross-origin URL as cross-origin", () => {
    expect(isSameOriginRequest("//evil.example.com/leak", undefined)).toBe(
      false,
    );
  });

  it("resolves a relative request URL against an absolute cross-origin baseURL", () => {
    expect(isSameOriginRequest("/me", "https://api.example.com")).toBe(false);
  });

  it("returns false for a malformed request URL", () => {
    expect(isSameOriginRequest("http://[", undefined)).toBe(false);
  });
});
