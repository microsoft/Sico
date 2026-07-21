import { afterEach, describe, expect, it, vi } from "vitest";

import { makeId } from "@/utils/id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("makeId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a v4 UUID", () => {
    expect(makeId()).toMatch(UUID_V4);
  });

  it("returns unique ids", () => {
    expect(makeId()).not.toBe(makeId());
  });

  // Regression: in an INSECURE context (plain HTTP, non-localhost — e.g. the
  // preview env) `crypto.randomUUID` is undefined. makeId must still mint a
  // valid id via the always-available `crypto.getRandomValues`, not throw
  // "crypto.randomUUID is not a function".
  it("works when crypto.randomUUID is unavailable (insecure context)", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
      // randomUUID intentionally absent
    });

    expect(() => makeId()).not.toThrow();
    expect(makeId()).toMatch(UUID_V4);
  });
});
