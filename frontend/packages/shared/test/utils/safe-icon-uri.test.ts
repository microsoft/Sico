import { describe, expect, it } from "vitest";

import { safeIconUri } from "@/utils/safe-icon-uri";

describe("safeIconUri", () => {
  it("returns undefined for undefined / empty", () => {
    expect(safeIconUri(undefined)).toBeUndefined();
    expect(safeIconUri("")).toBeUndefined();
  });

  it("passes relative paths through", () => {
    expect(safeIconUri("/avatars/1.png")).toBe("/avatars/1.png");
  });

  it("passes http(s) absolute URLs through", () => {
    expect(safeIconUri("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(safeIconUri("http://cdn.example.com/a.png")).toBe(
      "http://cdn.example.com/a.png",
    );
  });

  it("rejects dangerous schemes", () => {
    // eslint-disable-next-line no-script-url -- under test
    expect(safeIconUri("javascript:alert(1)")).toBeUndefined();
    expect(safeIconUri("data:image/png;base64,AAAA")).toBeUndefined();
    expect(safeIconUri("file:///etc/passwd")).toBeUndefined();
    expect(safeIconUri("blob:https://example.com/abc")).toBeUndefined();
  });

  it("rejects malformed strings", () => {
    expect(safeIconUri("not a url")).toBeUndefined();
  });

  // Same-origin SSRF guard: `<img src="/api/logout?confirm=1">` would be
  // GETed by the browser with cookies. Reject query/fragment on relative
  // paths so a hostile payload cannot turn the avatar slot into a
  // side-effect trigger against any GET endpoint.
  it("rejects relative paths with query string", () => {
    expect(safeIconUri("/api/logout?confirm=1")).toBeUndefined();
  });

  it("rejects relative paths with fragment", () => {
    expect(safeIconUri("/avatars/1.png#frag")).toBeUndefined();
  });

  // Protocol-relative URLs (`//host/path`) start with `/` but are
  // resolved by the browser against the page's *origin*, not the path
  // — turning the avatar slot into an off-origin GET. Reject before
  // the same-origin relative-path branch can pass them through.
  it("rejects protocol-relative URLs", () => {
    expect(safeIconUri("//evil.com/x.png")).toBeUndefined();
  });

  it("rejects backslash-smuggled protocol-relative URLs", () => {
    expect(safeIconUri("/\\evil.com/x.png")).toBeUndefined();
  });

  // Absolute URLs with userinfo (`https://user:pass@host/x`) leak
  // credentials in referrer headers and confuse origin parsing in
  // some logging pipelines. Reject.
  it("rejects absolute URLs with userinfo", () => {
    expect(safeIconUri("https://u:p@cdn.example.com/a.png")).toBeUndefined();
    expect(safeIconUri("https://user@cdn.example.com/a.png")).toBeUndefined();
  });
});
