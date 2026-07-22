/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
