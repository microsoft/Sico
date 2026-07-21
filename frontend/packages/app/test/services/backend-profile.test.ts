import { describe, expect, it } from "vitest";

import { PROFILES, resolveBackendKey } from "@/services/backend-profile";

// `resolveBackendKey` is the pure core: it takes the raw env string and
// returns a validated profile key (or throws). Keeping the env read out of
// it (the module-scope singleton does that) makes the policy testable
// without stubbing `import.meta.env`.
describe("resolveBackendKey", () => {
  it("defaults to sico when the env var is absent (undefined)", () => {
    expect(resolveBackendKey(undefined)).toBe("sico");
  });

  it("defaults to sico when the env var is the empty string", () => {
    expect(resolveBackendKey("")).toBe("sico");
  });

  it("returns dwp when explicitly set to dwp", () => {
    expect(resolveBackendKey("dwp")).toBe("dwp");
  });

  it("throws on an unknown key instead of silently falling back", () => {
    expect(() => resolveBackendKey("dpw")).toThrow(/dpw/);
  });

  // Drift guard: every key defined in PROFILES must resolve back to itself.
  // This locks the invariant that resolution is derived from PROFILES — a new
  // profile must not require a second edit elsewhere to become reachable.
  it.each(Object.keys(PROFILES))(
    "resolves every PROFILES key — %s — back to itself",
    (key) => {
      expect(resolveBackendKey(key)).toBe(key);
    },
  );
});

describe("PROFILES", () => {
  it("points sico at its own /api/sico backend", () => {
    expect(PROFILES.sico.baseURL).toBe("/api/sico");
  });

  it("points dwp at the /api/dwp backend with v2 chat paths", () => {
    expect(PROFILES.dwp.baseURL).toBe("/api/dwp");
    expect(PROFILES.dwp.chatEndpoints).toMatchObject({
      apiPrefix: "/api/dwp",
      messagesPath: "/conversation/messages_v2",
      chatPath: "/conversation/chat/v2",
      reconnectPath: "/conversation/chat/v2/reconnect",
    });
  });

  it("flips the declarative flags per backend", () => {
    expect(PROFILES.sico.sicoFlags).toMatchObject({
      loginPrefillCredentials: true,
      digitalWorkerCardShowStatus: false,
    });
    expect(PROFILES.dwp.sicoFlags).toMatchObject({
      loginPrefillCredentials: false,
      digitalWorkerCardShowStatus: true,
    });
  });
});
